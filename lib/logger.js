import fs from 'fs';

// Poziomy logowania w kolejności rosnącej szczegółowości
const LEVELS = {error: 0, warn: 1, info: 2, debug: 3};

// Logger w formacie JSON Lines - jedna linia JSON na zdarzenie.
// Gdy nie podano ścieżki pliku (uruchomienie z terminala), pisze czytelnie na konsolę.
export default function createLogger({logPath = null, level = 'debug'} = {}) {
    const threshold = LEVELS[level] ?? LEVELS.debug;
    const stream = logPath ? fs.createWriteStream(logPath, {flags: 'a'}) : null;

    function write(entry) {
        if ((LEVELS[entry.level] ?? LEVELS.debug) > threshold) return;

        if (stream) {
            const line = JSON.stringify({ts: new Date().toISOString(), ...entry}) + '\n';

            // Błędy zapisujemy synchronicznie. Strumień jest buforowany, a obsługa
            // sygnałów kończy proces natychmiast po zalogowaniu przyczyny - przez
            // bufor przepadłaby dokładnie ta linia, dla której ten log istnieje.
            if (entry.level === 'error') {
                try {
                    fs.appendFileSync(logPath, line);
                } catch {
                    // brak logu nie może przesłonić pierwotnego błędu
                }
                return;
            }

            stream.write(line);
            return;
        }

        // Tryb terminalowy - surowe wyjście narzędzi tylko przy debugu, reszta jako zwykły tekst
        if (entry.raw !== undefined) {
            if (threshold >= LEVELS.debug) console.error(`[${entry.tool}] ${entry.raw}`);
            return;
        }
        const target = entry.level === 'error' || entry.level === 'warn' ? console.error : console.log;
        target(entry.msg);
    }

    return {
        debug: (phase, msg, extra = {}) => write({level: 'debug', phase, msg, ...extra}),
        info: (phase, msg, extra = {}) => write({level: 'info', phase, msg, ...extra}),
        warn: (phase, msg, extra = {}) => write({level: 'warn', phase, msg, ...extra}),
        error: (phase, msg, extra = {}) => write({level: 'error', phase, msg, ...extra}),

        // Surowe stdout/stderr wywoływanych narzędzi (whisper-cli, ffmpeg)
        tool: (phase, tool, raw) => write({level: 'debug', phase, tool, raw}),

        close: () => new Promise(resolve => stream ? stream.end(resolve) : resolve()),
    };
}
