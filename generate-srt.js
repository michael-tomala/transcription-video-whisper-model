import fs from 'fs';

// Funkcja do konwersji czasu w sekundach na format SRT (HH:MM:SS,MS)
function convertToSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${padZero(hours)}:${padZero(minutes)}:${padZero(secs)},${padZero(millis, 3)}`;
}

// Funkcja do dodawania zer przed liczbą (do formatowania)
function padZero(number, length = 2) {
    return String(number).padStart(length, '0');
}

// Funkcja do generowania pliku SRT na podstawie pliku transcription.json
function generateSRT(filePath) {

    if (!filePath) {
        console.error('Brak ścieżki do pliku JSON z transkrypcjami! Proszę podać ścieżkę jako argument.');
        process.exit(1); // Zakończ aplikację, jeśli ścieżka nie została podana
    }

    // Wczytanie pliku transcription.json
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading the file:', err);
            return;
        }

        const transcriptionData = JSON.parse(data);
        let srtContent = '';
        let subtitleIndex = 2;

        // Dodanie początku
        srtContent += `1\n00:00:00,000 --> 00:00:00,100\nStart\n\n`;

        // Generowanie treści pliku SRT
        transcriptionData.forEach((entry) => {
            entry?.words.forEach((word) => {
                const startTime = convertToSRTTime(word.start);  // Start czas od pierwszego słowa
                const endTime = convertToSRTTime(word.end);  // End czas od ostatniego słowa

                // Dodanie do treści SRT
                srtContent += `${subtitleIndex}\n${startTime} --> ${endTime}\n${word.word}\n\n`;
                subtitleIndex++;
            })
        });

        // Zapisanie pliku SRT
        fs.writeFile('transcription.srt', srtContent, (err) => {
            if (err) {
                console.error('Error writing SRT file:', err);
            } else {
                console.log('SRT file has been saved!');
            }
        });
    });
}

// Uruchomienie funkcji
const filePath = process.argv[2] || './transcription.json';  // Ścieżka do pliku transcription.json
generateSRT(filePath);