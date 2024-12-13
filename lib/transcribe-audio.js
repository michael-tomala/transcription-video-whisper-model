import fs from 'fs';
import { execSync } from 'child_process';
import { OpenAI } from "openai";

export default async function transcribeAudio(audioPath) {
    // Pobierz długość pliku audio
    const durationCommand = `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`;
    const duration = parseFloat(execSync(durationCommand).toString());

    const fileStream = fs.createReadStream(audioPath);

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
    });

    // Dodaj informację o długości do zwracanego obiektu
    return {
        ...response,
        audio_duration: duration
    };
}