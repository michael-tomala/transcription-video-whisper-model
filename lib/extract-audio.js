import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import {trackChild, untrackChild} from './children.js';

// Nazwa pliku audio zależy od backendu: OpenAI dostaje mp3 (liczy się rozmiar uploadu),
// whisper.cpp chce WAV 16 kHz mono PCM.
export function audioFileName(format) {
    return format === 'wav' ? 'audio.wav' : 'audio.mp3';
}

// 1. Wyodrębnianie audio z wideo
export default function extractAudio(videoPath, outputDir, format = 'mp3') {
    const audioPath = path.join(outputDir, audioFileName(format));

    return new Promise((resolve, reject) => {
        const command = ffmpeg(videoPath);

        if (format === 'wav') {
            command.audioFrequency(16000).audioChannels(1).audioCodec('pcm_s16le');
        }

        // Rejestrujemy polecenie, żeby przerwanie zadania ubiło też ffmpeg -
        // inaczej zostaje sierotą mielącą długie wideo w tle.
        trackChild(command);

        command
            .output(audioPath)
            .on('end', () => {
                untrackChild(command);
                resolve(audioPath);
            })
            .on('error', (error) => {
                untrackChild(command);
                reject(error);
            })
            .run();
    });
}
