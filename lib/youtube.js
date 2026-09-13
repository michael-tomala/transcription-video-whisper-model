import youtubedl from 'youtube-dl-exec';
import path from 'path'
import {audioFileName} from './extract-audio.js';

export const downloadAudioFromYoutube = async (url, outputDir, format = 'mp3') => {
    return new Promise((resolve, reject) => {
        try {
            const outputFile = path.join(outputDir, audioFileName(format));

            const options = {
                extractAudio: true,
                audioFormat: format,
                output: outputFile,
                progress: true // Włącza pokazywanie postępu
            };

            // whisper.cpp oczekuje 16 kHz mono - wymuszamy to już na etapie pobierania
            if (format === 'wav') {
                options.postprocessorArgs = 'ExtractAudio:-ar 16000 -ac 1';
            }

            const download = youtubedl.exec(url, options);

            // exec() zwraca proces potomny będący jednocześnie obietnicą, która
            // odrzuca się przy niezerowym kodzie wyjścia. Bez tego .catch() Node
            // ubiłby proces przez ERR_UNHANDLED_REJECTION, zanim zdążylibyśmy
            // odrzucić naszą obietnicę z czytelnym komunikatem poniżej.
            download.catch(() => {});

            // Obsługa zakończenia
            download.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`yt-dlp zakończył się kodem ${code}`));
                }
                resolve(outputFile)
            });

            // Obsługa błędów
            download.on('error', (error) => {
                reject(error)
            });

        } catch (error) {
            reject(error)
        }

    })
};


export const extractYouTubeId = (url) => {
    if (!url) return null;

    // Obsługiwane formaty:
    // - youtube.com/watch?v=ID
    // - youtu.be/ID
    // - youtube.com/v/ID
    // - youtube.com/embed/ID
    // - youtube.com/shorts/ID
    // - youtube.com/?v=ID
    // - youtube.com/live/ID

    const patterns = [
        /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
        /youtube\.com\/shorts\/([^"&?\/\s]{11})/i,
        /youtube\.com\/live\/([^"&?\/\s]{11})/i
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    return null;
}


export const isYoutubeUrl = (videoPath) => {

    // Wzorce różnych formatów linków YouTube
    const youtubePatterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+(&\S*)?$/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+$/
    ];

    // Sprawdź czy videoPath to string
    if (typeof videoPath !== 'string') {
        return true; // Nie jest linkiem YT, bo nie jest nawet stringiem
    }

    // Sprawdź czy pasuje do któregokolwiek wzorca YouTube
    const isYouTubeUrl = youtubePatterns.some(pattern => pattern.test(videoPath));

    return !!isYouTubeUrl;
}
