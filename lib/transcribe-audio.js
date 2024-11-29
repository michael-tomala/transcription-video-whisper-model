import fs from 'fs';

// Tworzymy instancję OpenAI z kluczem API
import {OpenAI} from "openai";


// 3. Wysyłanie pliku audio do OpenAI Whisper z dodatkowymi opcjami
export default async function transcribeAudio(audioPath) {
    try {
        const fileStream = fs.createReadStream(audioPath);

        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY, // Twój klucz API OpenAI
        });

        const response = await openai.audio.transcriptions.create({
            file: fileStream,
            model: 'whisper-1', // Nazwa modelu Whisper
            response_format: 'verbose_json', // Ustawienie formatu odpowiedzi na verbose_json
            timestamp_granularities: ['word', 'segment'], // Dokładność timestampów do słów
        });

        return response;
    } catch (error) {
        console.error('Błąd podczas transkrypcji:', error.response || error.message);
        throw error;
    }
}