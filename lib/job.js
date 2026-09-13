import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawn} from 'child_process';
import crypto from 'crypto';

// Katalog uzgodniony z pluginem, który odpytuje o stan zadania
export const JOBS_DIR = path.join(os.homedir(), '.cache', 'ctowiec-screencast', 'jobs');

export function jobPaths(jobId) {
    return {
        statePath: path.join(JOBS_DIR, `${jobId}.json`),
        logPath: path.join(JOBS_DIR, `${jobId}.log`),
    };
}

export function createJobId() {
    // Math.random().toString(36) potrafi dać krótszy ciąg (np. 0.5 -> "5"), a kolizja
    // oznacza dwa zadania dzielące jeden plik stanu i log.
    return crypto.randomBytes(4).toString('hex');
}

export function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < 60) return '~1 min';
    return `~${Math.ceil(seconds / 60)} min`;
}

// Uchwyt do pliku stanu. Plugin może go czytać w dowolnym momencie, więc każdy
// zapis idzie przez plik tymczasowy i rename - nigdy nie zobaczy obciętego JSON-a.
export function createJobState(jobId, initial = {}) {
    const {statePath} = jobPaths(jobId);
    fs.mkdirSync(JOBS_DIR, {recursive: true});

    // Worker startuje na pliku założonym wcześniej przez proces-rodzica,
    // więc dokładamy się do istniejącego stanu zamiast go kasować.
    let existing = {};
    try {
        existing = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
        // pierwszy zapis dla tego zadania
    }

    let state = {
        jobId,
        status: 'pending',
        phase: null,
        progress: 0,
        pid: null,
        input: null,
        artifactPath: null,
        backend: null,
        model: null,
        startedAt: new Date().toISOString(),
        updatedAt: null,
        finishedAt: null,
        eta: null,
        error: null,
        ...existing,
        ...initial,
    };

    function readFromDisk() {
        try {
            return JSON.parse(fs.readFileSync(statePath, 'utf8'));
        } catch {
            return {};
        }
    }

    function flush() {
        state.updatedAt = new Date().toISOString();
        const tmpPath = `${statePath}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
        fs.renameSync(tmpPath, statePath); // atomowa podmiana w obrębie tego samego katalogu
    }

    flush();

    return {
        statePath,
        snapshot: () => ({...state}),
        // Stan zapisują dwa procesy: rodzic (dokłada pid tuż po spawnie) i worker.
        // Dlatego zamiast nadpisywać plik swoją migawką, dokładamy tylko zmienione
        // pola do tego, co aktualnie leży na dysku - inaczej rodzic cofnąłby joba
        // z "running" z powrotem na "pending".
        update(patch) {
            state = {...state, ...readFromDisk(), ...patch};
            flush();
        },
    };
}

// Odczepienie od procesu rodzica: dziecko dostaje własną grupę procesów i przeżywa
// zamknięcie terminala, a rodzic natychmiast wypisuje jobId i kończy pracę.
export function spawnDetachedWorker({jobId, argv, logPath}) {
    fs.mkdirSync(JOBS_DIR, {recursive: true});
    const logFd = fs.openSync(logPath, 'a');

    const child = spawn(
        process.execPath,
        [process.argv[1], ...argv, '--foreground', '--job-id', jobId],
        {
            detached: true,
            stdio: ['ignore', logFd, logFd],
            cwd: process.cwd(),
            env: process.env,
        }
    );

    child.unref();
    fs.closeSync(logFd);

    return child.pid;
}

// Proces jest odczepiony, więc nikt nie zobaczy wyjątku - każde nienaturalne
// zakończenie musi wylądować w pliku stanu, inaczej plugin utknie na "running".
export function installFailureHandlers(jobState, logger, onCleanup) {
    let handled = false;

    const fail = (reason) => {
        if (handled) return;
        handled = true;
        logger?.error('job', reason);
        try {
            onCleanup?.();
        } catch {
            // sprzątanie nie może przesłonić pierwotnego błędu
        }
        try {
            jobState.update({status: 'error', error: reason, finishedAt: new Date().toISOString()});
        } catch {
            // nie mamy już gdzie tego zgłosić
        }
    };

    process.on('SIGTERM', () => {
        fail('Przerwano sygnałem SIGTERM');
        process.exit(143);
    });
    process.on('SIGINT', () => {
        fail('Przerwano sygnałem SIGINT');
        process.exit(130);
    });
    process.on('uncaughtException', (err) => {
        fail(`Nieobsłużony wyjątek: ${err?.stack || err?.message || err}`);
        process.exit(1);
    });
    process.on('unhandledRejection', (err) => {
        fail(`Nieobsłużone odrzucenie obietnicy: ${err?.stack || err?.message || err}`);
        process.exit(1);
    });

    return fail;
}
