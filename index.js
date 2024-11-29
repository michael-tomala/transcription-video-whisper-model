import combineTranscriptions from "./lib/combine-transcriptions.js";
import extractAudio from "./lib/extract-audio.js";
import splitAudioFile from "./lib/split-audio-file.js";
import dotenv from 'dotenv';
import transcribeAudio from "./lib/transcribe-audio.js";
import fs from 'fs';
// Ładujemy zmienne środowiskowe z pliku .env
dotenv.config();

(async () => {
    // Pobranie ścieżki do pliku wideo z argumentów przekazanych przy uruchamianiu aplikacji
    const videoPath = process.argv[2]; // Pierwszy argument to ścieżka do pliku wideo
    if (!videoPath) {
        console.error('Brak ścieżki do pliku wideo! Proszę podać ścieżkę jako argument.');
        process.exit(1); // Zakończ aplikację, jeśli ścieżka nie została podana
    }
    if (!process.env.OPENAI_API_KEY) {
        console.error('Brak klucza OPENAI_API_KEY w pliku .env');
        process.exit(1); // Zakończ aplikację, jeśli ścieżka nie została podana
    }

    const audioPath = './.tmp/output_audio.mp3'; // Ścieżka do pliku audio

    try {
        await fs.rmSync('.tmp', {recursive: true})
    } catch (err) {
    }
    await fs.mkdirSync('.tmp')

    try {

        console.log('Wyodrębnianie audio...');
        await extractAudio(videoPath, audioPath);

        console.log('Sprawdzanie rozmiaru pliku audio...');
        const chunks = await splitAudioFile(audioPath);

        console.log(`Dzielimy plik na ${chunks.length} kawałków...`);

        const transcriptions = [];

        for (let chunk of chunks) {
            console.log(`Wysyłanie pliku ${chunk} do Whisper API...`);
            const transcription = await transcribeAudio(chunk);
            transcriptions.push(transcription);
        }

        console.log('Łączenie transkrypcji...');
        const combinedTranscription = combineTranscriptions(transcriptions);

        console.log('Transkrypcja (verbose_json):');
        console.log(combinedTranscription);

        // Zapis transkrypcji do pliku
        fs.writeFileSync('transcription.json', JSON.stringify(transcriptions, null, 2));
        console.log('Transkrypcja zapisana w transcription.json');
    } catch (error) {
        console.error('Wystąpił błąd:', error);
    }
})();