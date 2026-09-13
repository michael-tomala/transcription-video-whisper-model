import fs from 'fs';
import os from 'os';
import path from 'path';
import {execFileSync} from 'child_process';
import {fileURLToPath} from 'url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Modele ggml zainstalowane lokalnie przez SuperWhisper - jedyne pełnowymiarowe,
// jakie są na tej maszynie (Homebrew dostarcza tylko atrapę do testów).
const SUPERWHISPER_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'superwhisper');

const MODEL_ALIASES = {
    large: path.join(SUPERWHISPER_DIR, 'ggml-large.bin'),
    small: path.join(SUPERWHISPER_DIR, 'ggml-small.bin'),
};

// large-v2 jest multilingual (99 języków) - wymagane dla materiału po polsku
export const DEFAULT_MODEL_ALIAS = 'large';

// Model VAD trzymamy przy repo (pobierany osobno, patrz README) - nie ma go w dystrybucji
// whisper.cpp. Ścieżka liczona od katalogu pakietu, nie od cwd: plugin uruchamia to CLI
// z dowolnego katalogu roboczego.
export const DEFAULT_VAD_MODEL = path.join(PACKAGE_ROOT, 'models', 'ggml-silero-v5.1.2.bin');

// Zmierzony na M2 Pro (large-v2, Metal, -t 8): ~10x realtime.
// Używane wyłącznie do wyliczenia ETA dla pliku stanu joba.
export const REALTIME_FACTOR = 0.12;

export function resolveModelPath(value) {
    const raw = value || process.env.WHISPER_MODEL_PATH || DEFAULT_MODEL_ALIAS;
    return MODEL_ALIASES[raw] || path.resolve(raw);
}

export function resolveVadModelPath(value) {
    const raw = value || process.env.WHISPER_VAD_MODEL_PATH;
    return raw ? path.resolve(raw) : DEFAULT_VAD_MODEL;
}

// Sprawdzenie wszystkich zależności backendu lokalnego ZANIM ruszy przetwarzanie.
// Proces jest odczepiony od rodzica, więc musi paść szybko i z czytelnym komunikatem.
export function assertLocalBackendReady({modelPath, vadModelPath, vad}) {
    try {
        execFileSync('whisper-cli', ['--help'], {stdio: 'ignore'});
    } catch {
        throw new Error(
            'Nie znaleziono "whisper-cli" w PATH. Zainstaluj: brew install whisper-cpp'
        );
    }

    if (!fs.existsSync(modelPath)) {
        throw new Error(
            `Nie znaleziono modelu whisper: ${modelPath}\n` +
            `Wskaż inny przez --model <ścieżka> albo WHISPER_MODEL_PATH w .env`
        );
    }

    if (vad && !fs.existsSync(vadModelPath)) {
        throw new Error(
            `Nie znaleziono modelu VAD: ${vadModelPath}\n` +
            `Pobierz: curl -fL -o models/ggml-silero-v5.1.2.bin ` +
            `https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin\n` +
            `Albo wyłącz wycinanie ciszy flagą --no-vad`
        );
    }
}
