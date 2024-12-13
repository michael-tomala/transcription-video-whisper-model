import combineTranscriptions from "./lib/combine-transcriptions.js";
import extractAudio from "./lib/extract-audio.js";
import splitAudioFile from "./lib/split-audio-file.js";
import dotenv from 'dotenv';
import transcribeAudio from "./lib/transcribe-audio.js";
import fs from 'fs';
import path from "path";
import generateReformatedTranscription from "./lib/reformat-transcription.js";
import generateSRT from "./lib/generate-srt.js";

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

    const reformatMinWordsDuration = process.argv[3] || 500; // Pierwszy argument to ścieżka do pliku wideo

    const outputDir = 'output/' + path.basename(videoPath).replace(/\.[^/.]+$/, "").toLowerCase().replace(' ', '')

    try {
        await fs.rmSync(outputDir, {recursive: true})
    } catch (err) {
    }
    await fs.mkdirSync(outputDir)

    try {

        console.log('Wyodrębnianie audio...');
        await extractAudio(videoPath, outputDir);

        console.log('Sprawdzanie rozmiaru pliku audio...');
        const chunks = await splitAudioFile(outputDir);
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
        console.log(combinedTranscription.text);

        await fs.writeFileSync(outputDir + '/transcription.json', JSON.stringify(combinedTranscription, null, 2));
        console.log(`Transkrypcja zapisana w ${outputDir}/transcription.json`);

        await generateReformatedTranscription(outputDir, reformatMinWordsDuration)
        console.log(`Poprawiona transkrypcja została zapisana w ${outputDir}/transcription-reformatted.json`);

        await generateSRT(outputDir, 'words');
        console.log(`Transkrypcja typu "words" została zapisana.`);

        await generateSRT(outputDir, 'segments');
        console.log(`Transkrypcja typu "segments" została zapisana.`);

    } catch (error) {
        console.error('Wystąpił błąd:', error);
    }
})();