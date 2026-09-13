import fs from 'fs';
import {execSync} from 'child_process';
import {OpenAI} from "openai";

// Transkrypcja przez API OpenAI (model whisper-1)
export default async function transcribeWithOpenAI(audioPath, {logger} = {}) {
    // Pobierz długość pliku audio
    const durationCommand = `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`;
    const duration = parseFloat(execSync(durationCommand).toString());

    const fileStream = fs.createReadStream(audioPath);

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    logger?.debug('transcribe', `Wysyłanie ${audioPath} do Whisper API...`);

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
