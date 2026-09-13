import {parseArgs} from 'node:util';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import combineTranscriptions from "./lib/combine-transcriptions.js";
import extractAudio, {audioFileName} from "./lib/extract-audio.js";
import splitAudioFile from "./lib/split-audio-file.js";
import transcribeAudio, {BACKENDS} from "./lib/transcribe-audio.js";
import generateReformatedTranscription from "./lib/reformat-transcription.js";
import generateSRT from "./lib/generate-srt.js";
import {downloadAudioFromYoutube, extractYouTubeId, isYoutubeUrl} from "./lib/youtube.js";
import createLogger from "./lib/logger.js";
import {probeDuration} from "./lib/whisper-local.js";
import {killActiveChildren} from "./lib/children.js";
import {
    assertLocalBackendReady,
    resolveModelPath,
    resolveVadModelPath,
    REALTIME_FACTOR,
} from "./lib/models.js";
import {
    createJobId,
    createJobState,
    formatEta,
    installFailureHandlers,
    jobPaths,
    spawnDetachedWorker,
} from "./lib/job.js";

// Ładujemy zmienne środowiskowe z pliku .env
dotenv.config();

// Ostrożne przybliżenie 224 tokenów dla polskiego tekstu.
const PROMPT_WARN_LENGTH = 800;

const USAGE = `
Użycie: node index.js <plik wideo | URL YouTube> [opcje]

  --backend <openai|local>   silnik transkrypcji (domyślnie openai)
  --model <ścieżka|alias>    model ggml dla backendu local (large, small lub ścieżka)
  --vad / --no-vad           wycinanie ciszy przed transkrypcją (domyślnie włączone dla local)
  --vad-model <ścieżka>      model Silero VAD
  --language <kod>           język nagrania (domyślnie pl)
  --threads <n>              liczba wątków whisper.cpp (domyślnie 8)
  --prompt <tekst>           nazwy własne/żargon podpowiadane modelowi (oba backendy)
  --min-words-duration <ms>  minimalny czas wyświetlania frazy w SRT (domyślnie 500)
  --output-dir <ścieżka>     katalog wyniku (domyślnie output/<nazwa>)
  --job                      uruchom w tle, wypisz jobId na stdout i zakończ
  --help                     ta pomoc
`.trim();

function parseOptions(argv) {
    const {values, positionals} = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            backend: {type: 'string'},
            model: {type: 'string'},
            vad: {type: 'boolean'},
            'no-vad': {type: 'boolean'},
            'vad-model': {type: 'string'},
            language: {type: 'string'},
            threads: {type: 'string'},
            prompt: {type: 'string'},
            'min-words-duration': {type: 'string'},
            'output-dir': {type: 'string'},
            job: {type: 'boolean'},
            'job-id': {type: 'string'},
            foreground: {type: 'boolean'},
            help: {type: 'boolean'},
        },
    });

    const backend = values.backend || 'openai';
    if (!BACKENDS.includes(backend)) {
        throw new Error(`Nieznany backend "${backend}". Dostępne: ${BACKENDS.join(', ')}`);
    }

    // Bez tego "--threads szybko" trafiłoby do whisper-cli jako literalne "NaN",
    // a NaN w --min-words-duration po cichu wyłączyłby scalanie słów we frazy.
    const number = (raw, fallback, flag) => {
        if (raw === undefined || raw === null || raw === '') return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`Opcja ${flag} wymaga dodatniej liczby, otrzymano "${raw}"`);
        }
        return parsed;
    };

    // whisper.cpp przycina initial prompt do n_text_ctx/2 = 224 tokenów, API whisper-1 tak samo.
    // Nadmiar jest obcinany po cichu, więc bez ostrzeżenia wygląda to jak "słownik nie zadziałał".
    const prompt = values.prompt || undefined;
    if (prompt && prompt.length > PROMPT_WARN_LENGTH) {
        console.warn(`Uwaga: --prompt ma ${prompt.length} znaków; Whisper użyje tylko pierwszych ~224 tokenów.`);
    }

    return {
        help: Boolean(values.help),
        input: positionals[0],
        // Wsteczna zgodność: drugi argument pozycyjny to dawne minWordsDuration
        minWordsDuration: number(values['min-words-duration'] ?? positionals[1], 500, '--min-words-duration'),
        backend,
        modelPath: resolveModelPath(values.model),
        vad: values['no-vad'] ? false : (values.vad ?? true),
        vadModelPath: resolveVadModelPath(values['vad-model']),
        language: values.language || 'pl',
        prompt,
        threads: number(values.threads, 8, '--threads'),
        outputDir: values['output-dir'],
        job: Boolean(values.job),
        jobId: values['job-id'],
        foreground: Boolean(values.foreground),
    };
}

function resolveOutputDir(options) {
    if (options.outputDir) return options.outputDir;

    const dirname = isYoutubeUrl(options.input)
        ? extractYouTubeId(options.input)
        : path.basename(options.input);

    return path.join('output', dirname.replace(/\.[^/.]+$/, "").toLowerCase().replace(' ', ''));
}

// Walidacja wykonywana ZANIM proces się odczepi - inaczej błąd konfiguracji
// zobaczyłby dopiero plugin, kilkanaście sekund później, w pliku stanu.
function assertBackendReady(options) {
    if (options.backend === 'local') {
        assertLocalBackendReady(options);
    } else if (!process.env.OPENAI_API_KEY) {
        throw new Error('Brak klucza OPENAI_API_KEY w pliku .env (wymagany dla --backend openai)');
    }
}

function estimateSeconds(options) {
    if (isYoutubeUrl(options.input)) return null; // nie znamy długości przed pobraniem
    try {
        return probeDuration(options.input) * REALTIME_FACTOR;
    } catch {
        return null;
    }
}

// Tryb --job: zakładamy plik stanu, odczepiamy workera i natychmiast oddajemy sterowanie.
function startBackgroundJob(options, rawArgv) {
    const jobId = createJobId();
    const {statePath, logPath} = jobPaths(jobId);
    const eta = formatEta(estimateSeconds(options));

    const jobState = createJobState(jobId, {
        input: options.input,
        backend: options.backend,
        model: options.backend === 'local' ? path.basename(options.modelPath) : 'whisper-1',
        artifactPath: path.resolve(resolveOutputDir(options)),
        eta,
    });

    // Worker nie może dostać --job, bo zacząłby odczepiać kolejnego siebie
    const workerArgv = rawArgv.filter(arg => arg !== '--job');
    const pid = spawnDetachedWorker({jobId, argv: workerArgv, logPath});
    jobState.update({pid});

    process.stdout.write(JSON.stringify({jobId, eta, statePath, logPath, pid}) + '\n');
}

async function run(options) {
    const {logPath} = options.jobId ? jobPaths(options.jobId) : {logPath: null};
    const logger = createLogger({logPath, level: options.jobId ? 'debug' : 'info'});

    const jobState = options.jobId
        ? createJobState(options.jobId, {
            input: options.input,
            backend: options.backend,
            model: options.backend === 'local' ? path.basename(options.modelPath) : 'whisper-1',
            pid: process.pid,
        })
        : null;

    if (jobState) installFailureHandlers(jobState, logger, killActiveChildren);

    const setPhase = (phase, progress) => {
        logger.info(phase, `Faza: ${phase}`);
        jobState?.update({status: 'running', phase, progress});
    };
    const setProgress = (progress) => jobState?.update({progress});

    const outputDir = resolveOutputDir(options);

    // Czyścimy tylko katalog, który sami wyznaczyliśmy (output/<nazwa>). Katalog
    // podany przez użytkownika bywa czymś w rodzaju ~/Videos - rekurencyjne kasowanie
    // zabrałoby razem z poprzednim wynikiem także plik wejściowy.
    if (!options.outputDir) {
        fs.rmSync(outputDir, {recursive: true, force: true});
    }
    fs.mkdirSync(outputDir, {recursive: true});

    jobState?.update({artifactPath: path.resolve(outputDir)});

    // whisper.cpp pracuje na WAV 16 kHz mono, API OpenAI na mp3 (liczy się rozmiar uploadu)
    const audioFormat = options.backend === 'local' ? 'wav' : 'mp3';

    setPhase('extract', 0.02);

    if (isYoutubeUrl(options.input)) {
        logger.info('extract', `Pobieranie audio z URL: ${options.input}`);
        await downloadAudioFromYoutube(options.input, outputDir, audioFormat);
    } else {
        logger.info('extract', 'Wyodrębnianie audio...');
        await extractAudio(options.input, outputDir, audioFormat);
    }

    const audioPath = path.join(outputDir, audioFileName(audioFormat));

    setPhase('transcribe', 0.1);

    const transcriptions = [];

    if (options.backend === 'local') {
        // Jeden przebieg na całe nagranie - whisper.cpp i tak mieli oknami 30 s
        transcriptions.push(await transcribeAudio(audioPath, {
            ...options,
            logger,
            onProgress: (p) => setProgress(0.1 + p * 0.8),
        }));
    } else {
        // Dzielenie jest potrzebne wyłącznie przez limit uploadu API OpenAI
        logger.info('transcribe', 'Sprawdzanie rozmiaru pliku audio...');
        const chunks = await splitAudioFile(outputDir);
        logger.info('transcribe', `Dzielimy plik na ${chunks.length} kawałków...`);

        for (const [index, chunk] of chunks.entries()) {
            logger.info('transcribe', `Wysyłanie pliku ${chunk} do Whisper API...`);
            transcriptions.push(await transcribeAudio(chunk, {...options, logger}));
            setProgress(0.1 + ((index + 1) / chunks.length) * 0.8);
        }
    }

    setPhase('postprocess', 0.9);

    logger.info('postprocess', 'Łączenie transkrypcji...');
    const combinedTranscription = combineTranscriptions(transcriptions);

    fs.writeFileSync(
        path.join(outputDir, 'transcription.json'),
        JSON.stringify(combinedTranscription, null, 2)
    );
    logger.info('postprocess', `Transkrypcja zapisana w ${outputDir}/transcription.json`);

    await generateReformatedTranscription(outputDir, options.minWordsDuration);
    logger.info('postprocess', `Poprawiona transkrypcja zapisana w ${outputDir}/transcription-reformatted.json`);

    await generateSRT(outputDir, 'words');
    await generateSRT(outputDir, 'segments');
    logger.info('postprocess', 'Pliki SRT ("words" i "segments") zapisane.');

    jobState?.update({
        status: 'done',
        phase: 'postprocess',
        progress: 1,
        finishedAt: new Date().toISOString(),
    });

    await logger.close();
}

(async () => {
    const rawArgv = process.argv.slice(2);
    let options;

    try {
        options = parseOptions(rawArgv);
    } catch (error) {
        console.error(error.message);
        console.error(`\n${USAGE}`);
        process.exit(1);
    }

    if (options.help) {
        console.log(USAGE);
        return;
    }

    if (!options.input) {
        console.error('Brak ścieżki do pliku wideo! Proszę podać ścieżkę jako argument.\n');
        console.error(USAGE);
        process.exit(1);
    }

    try {
        assertBackendReady(options);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    if (options.job && !options.foreground) {
        startBackgroundJob(options, rawArgv);
        return;
    }

    try {
        await run(options);
    } catch (error) {
        // W trybie job stan błędu zapisuje installFailureHandlers przez uncaughtException,
        // ale tutaj mamy jeszcze kontekst - logujemy i kończymy niezerowym kodem.
        if (options.jobId) {
            const {logPath} = jobPaths(options.jobId);
            createJobState(options.jobId, {}).update({
                status: 'error',
                error: error.message,
                finishedAt: new Date().toISOString(),
            });
            fs.appendFileSync(logPath, JSON.stringify({
                ts: new Date().toISOString(), level: 'error', phase: 'job', msg: error.stack || error.message,
            }) + '\n');
        } else {
            console.error('Wystąpił błąd:', error.message);
        }
        process.exit(1);
    }
})();
