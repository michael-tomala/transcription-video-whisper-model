import fs from 'fs';
import path from 'path';
import {spawn, execFileSync} from 'child_process';
import {trackChild, untrackChild} from './children.js';

// whisper.cpp raportuje postęp na stderr w tym formacie
const PROGRESS_RE = /progress\s*=\s*(\d+)%/;

// Tokeny sterujące whispera ([_BEG_], [_TT_368], ...) - nie są częścią transkrypcji
const SPECIAL_TOKEN_RE = /^\[_.*\]$/;

// vad-speech-segments podaje czasy w setnych sekundy
const VAD_SEGMENT_RE = /start\s*=\s*([\d.]+),\s*end\s*=\s*([\d.]+)/;

// Wycinamy tylko pauzy dłuższe niż to - krótsze przerwy zostawiamy,
// bo naturalna prozodia poprawia jakość rozpoznania.
const MIN_SILENCE_TO_CUT = 1.5;

// Margines wokół zachowanego materiału, żeby nie obciąć początku/końca słowa
const KEEP_PAD = 0.25;

// Poniżej tej oszczędności przekodowywanie audio się nie opłaca
const MIN_SAVING_RATIO = 0.03;

const msToSec = (ms) => ms / 1000;

export function probeDuration(audioPath) {
    const out = execFileSync('ffprobe', [
        '-i', audioPath,
        '-show_entries', 'format=duration',
        '-v', 'quiet',
        '-of', 'csv=p=0',
    ]).toString();

    const duration = parseFloat(out);
    if (!Number.isFinite(duration) || duration <= 0) {
        // Niektóre kontenery zwracają "N/A". Bez sensownej długości VAD zbudowałby
        // zakresy z NaN i ffmpeg dostałby atrim=...:end=NaN.
        throw new Error(`ffprobe nie podał długości pliku ${audioPath} (otrzymano: "${out.trim()}")`);
    }
    return duration;
}

// Wykrycie fragmentów mowy modelem Silero. Używamy osobnego narzędzia zamiast
// flagi --vad w whisper-cli, bo tamta zwraca timestampy w osi audio PO wycięciu
// ciszy i nie da się ich wiarygodnie odwzorować na oryginalne nagranie.
async function detectSpeechRegions(audioPath, {vadModelPath, threads, logger}) {
    const lines = await runTool('vad-speech-segments', [
        '-vm', vadModelPath,
        '-f', audioPath,
        '-t', String(threads),
        '-np',
    ], {logger, phase: 'vad'});

    const regions = [];
    for (const line of lines) {
        const match = line.match(VAD_SEGMENT_RE);
        if (!match) continue;
        regions.push({start: Number(match[1]) / 100, end: Number(match[2]) / 100});
    }

    logger?.debug('vad', `Wykryto ${regions.length} fragmentów mowy`);
    return regions;
}

// Zamiana fragmentów mowy na zakresy do zachowania: scalamy wszystko, co dzieli
// pauza krótsza niż MIN_SILENCE_TO_CUT, i dokładamy margines bezpieczeństwa.
export function buildKeepRanges(regions, duration, {minSilence = MIN_SILENCE_TO_CUT, pad = KEEP_PAD} = {}) {
    if (!regions.length) return [];

    const ranges = [];
    let current = {...regions[0]};

    for (const region of regions.slice(1)) {
        if (region.start - current.end < minSilence) {
            current.end = region.end;
        } else {
            ranges.push(current);
            current = {...region};
        }
    }
    ranges.push(current);

    // Margines może wyjść poza nagranie albo skleić sąsiednie zakresy - normalizujemy
    const padded = [];
    for (const range of ranges) {
        const start = Math.max(0, range.start - pad);
        const end = Math.min(duration, range.end + pad);
        const last = padded[padded.length - 1];

        if (last && start <= last.end) {
            last.end = Math.max(last.end, end);
        } else {
            padded.push({start, end});
        }
    }

    return padded;
}

// Sklejenie zachowanych zakresów w jeden plik audio
async function buildCompressedAudio(audioPath, ranges, outputPath, logger) {
    const parts = ranges.map((range, i) =>
        `[0:a]atrim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},asetpts=N/SR/TB[a${i}]`
    );
    const labels = ranges.map((_, i) => `[a${i}]`).join('');
    const graph = `${parts.join(';')};${labels}concat=n=${ranges.length}:v=0:a=1[out]`;

    await runTool('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', audioPath,
        '-filter_complex', graph,
        '-map', '[out]',
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        outputPath, '-y',
    ], {logger, phase: 'vad'});

    logger?.debug('vad', `Zapisano audio bez ciszy: ${outputPath}`);
    return outputPath;
}

// Odwzorowanie czasu z osi po wycięciu ciszy z powrotem na oryginalne nagranie.
// Mapowanie jest odcinkami liniowe i dokładne, bo sami budowaliśmy sklejkę.
export function createTimeMapper(ranges) {
    if (!ranges.length) {
        return {at: (t) => t, interval: (start, end) => [start, Math.max(start, end)]};
    }

    const cumulative = [];
    let acc = 0;
    for (const range of ranges) {
        cumulative.push(acc);
        acc += range.end - range.start;
    }
    const total = acc;

    // Indeks fragmentu, w którym leży dany moment osi skompresowanej.
    // Zakresów jest niewiele (dziesiątki), więc liniowe szukanie wystarcza.
    function locate(compressed) {
        const clamped = Math.min(Math.max(compressed, 0), total);
        let index = 0;
        while (index + 1 < ranges.length && clamped >= cumulative[index + 1]) index++;
        return index;
    }

    function at(compressed) {
        if (compressed <= 0) return ranges[0].start;
        if (compressed >= total) return ranges[ranges.length - 1].end;
        const index = locate(compressed);
        return ranges[index].start + (compressed - cumulative[index]);
    }

    return {
        at,
        // Przedział musi zostać w jednym fragmencie mowy. Bez tego słowo kończące
        // się tuż przed wyciętą ciszą dostałoby koniec dopiero po niej i rozciągnęłoby
        // się na kilkanaście sekund.
        interval(startCompressed, endCompressed) {
            const start = at(startCompressed);
            const startIndex = locate(startCompressed);
            const endIndex = locate(endCompressed);

            const end = endIndex > startIndex
                ? ranges[startIndex].end
                : at(endCompressed);

            return [start, Math.max(start, end)];
        },
    };
}

// Sklejanie tokenów w słowa. whisper.cpp tokenizuje na kawałki BPE, w których
// nowe słowo rozpoznajemy po wiodącej spacji; interpunkcja i końcówki doklejają się
// do słowa poprzedniego.
function tokensToWords(tokens, mapper) {
    const words = [];

    for (const token of tokens) {
        const text = token.text;
        if (!text || SPECIAL_TOKEN_RE.test(text)) continue;

        const [start, end] = mapper.interval(msToSec(token.offsets.from), msToSec(token.offsets.to));
        const last = words[words.length - 1];

        if (text.startsWith(' ') || !last) {
            const word = text.trim();
            if (!word) continue;
            words.push({word, start, end: Math.max(start, end)});
        } else {
            last.word += text;
            last.end = Math.max(last.end, end);
        }
    }

    return words;
}

// Mapowanie wyjścia whisper.cpp (-oj -ojf) na kontrakt zgodny z OpenAI verbose_json,
// dzięki czemu combine-transcriptions / reformat-transcription / generate-srt działają bez zmian.
function mapWhisperCppJson(raw, audioDuration, mapper) {
    const segments = [];
    const words = [];

    for (const entry of raw.transcription || []) {
        const text = entry.text || '';
        if (!text.trim()) continue; // whisper.cpp zwraca puste segmenty na granicach okien

        const segmentWords = tokensToWords(entry.tokens || [], mapper);

        // Granice segmentu bierzemy ze słów, a nie z mapper.interval(). Przycinanie
        // do jednego fragmentu mowy jest poprawne dla słowa, ale nie dla segmentu:
        // zdanie przerwane ciszą urwałoby się na jej początku i napis zniknąłby
        // z ekranu, choć mówca nadal je wypowiada.
        const [fallbackStart, fallbackEnd] =
            mapper.interval(msToSec(entry.offsets.from), msToSec(entry.offsets.to));

        const segStart = segmentWords.length ? segmentWords[0].start : fallbackStart;
        const segEnd = segmentWords.length
            ? segmentWords[segmentWords.length - 1].end
            : fallbackEnd;

        segments.push({
            start: segStart,
            end: Math.max(segStart, segEnd),
            text,
            words: segmentWords,
        });

        words.push(...segmentWords);
    }

    return {
        text: segments.map(s => s.text.trim()).join(' '),
        language: raw.result?.language,
        segments,
        words,
        audio_duration: audioDuration,
    };
}

// Uruchomienie narzędzia zewnętrznego. Świadomie asynchroniczne: wersja *Sync
// blokuje pętlę zdarzeń, przez co proces nie reaguje na SIGTERM ani nie zapisuje
// postępu, dopóki narzędzie nie skończy pracy.
function runTool(command, args, {logger, phase = 'transcribe', onLine} = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
        trackChild(child);

        const lines = [];
        const buffers = {stdout: '', stderr: ''};

        const consume = (stream) => (chunk) => {
            buffers[stream] += chunk.toString();
            const parts = buffers[stream].split('\n');
            buffers[stream] = parts.pop();

            for (const line of parts) {
                if (!line.trim()) continue;
                lines.push(line);
                logger?.tool(phase, command, line);
                onLine?.(line);
            }
        };

        child.stdout.on('data', consume('stdout'));
        child.stderr.on('data', consume('stderr'));

        child.on('error', (err) => {
            untrackChild(child);
            reject(new Error(`Nie udało się uruchomić ${command}: ${err.message}`));
        });

        child.on('close', (code, signal) => {
            untrackChild(child);

            if (code !== 0) {
                const reason = signal ? `sygnałem ${signal}` : `kodem ${code}`;
                return reject(new Error(
                    `${command} zakończył się ${reason}:\n${lines.slice(-20).join('\n')}`
                ));
            }
            resolve(lines);
        });
    });
}

// Transkrypcja lokalnym whisper.cpp. Cały plik idzie jednym wywołaniem -
// whisper.cpp przetwarza strumieniowo oknami 30 s, więc dzielenie nic by nie dało.
export default async function transcribeWithLocalWhisper(audioPath, options = {}) {
    const {
        modelPath,
        vad = true,
        vadModelPath,
        language = 'pl',
        threads = 8,
        prompt,
        logger,
        onProgress,
    } = options;

    const audioDuration = probeDuration(audioPath);
    const workDir = path.dirname(audioPath);

    let inputPath = audioPath;
    let mapper = createTimeMapper([]);

    if (vad) {
        const regions = await detectSpeechRegions(audioPath, {vadModelPath, threads, logger});
        const ranges = buildKeepRanges(regions, audioDuration);
        const kept = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);

        if (!ranges.length) {
            logger?.warn('vad', 'Nie wykryto mowy - transkrybuję całe nagranie bez wycinania ciszy');
        } else if (kept > audioDuration * (1 - MIN_SAVING_RATIO)) {
            logger?.info('vad', 'Prawie brak ciszy do wycięcia - pomijam przetwarzanie audio');
        } else {
            logger?.info('vad', `Wycinam ciszę: ${audioDuration.toFixed(1)}s -> ${kept.toFixed(1)}s ` +
                `(${ranges.length} fragmentów mowy)`);
            inputPath = await buildCompressedAudio(audioPath, ranges, path.join(workDir, 'audio-vad.wav'), logger);
            mapper = createTimeMapper(ranges);
        }
    }

    const outputPrefix = path.join(workDir, 'whisper');
    const args = [
        '-m', modelPath,
        '-f', inputPath,
        '-l', language,
        '-t', String(threads),
        '-oj', '-ojf',          // JSON z tokenami -> segmenty i słowa w jednym przebiegu
        '-of', outputPrefix,
        '-np',                  // bez wypisywania transkrypcji na stdout
        '-pp',                  // ...ale z postępem, który parsujemy
    ];

    // Tylko długa forma: w whisper-cli "-p" to --processors, nie initial prompt.
    if (prompt) args.push('--prompt', prompt);

    logger?.debug('transcribe', 'Uruchamianie whisper-cli', {args});
    await runTool('whisper-cli', args, {
        logger,
        phase: 'transcribe',
        onLine: (line) => {
            const match = line.match(PROGRESS_RE);
            if (match) onProgress?.(Number(match[1]) / 100);
        },
    });

    const jsonPath = `${outputPrefix}.json`;
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`whisper-cli nie zapisał pliku ${jsonPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const result = mapWhisperCppJson(raw, audioDuration, mapper);

    if (!result.words.length) {
        logger?.warn('transcribe', 'Transkrypcja nie zawiera żadnych słów - sprawdź audio i język');
    }

    onProgress?.(1);
    return result;
}
