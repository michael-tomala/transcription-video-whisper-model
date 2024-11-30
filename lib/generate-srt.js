import fs from 'fs';
import path from "path";

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
export default function generateSRT(outputDir, type = 'segments') {

    const filePath = outputDir + '/transcription-reformatted.json'

    // Wczytanie pliku transcription.json
    const data = fs.readFileSync('./' + filePath, 'utf8')

    const transcriptionData = JSON.parse(data);
    let srtContent = '';
    let subtitleIndex = 1;

    // Generowanie treści pliku SRT
    transcriptionData.forEach((entry) => {
        if (type === 'words') {
            entry?.words.forEach((word) => {
                const startTime = convertToSRTTime(word.start);  // Start czas od pierwszego słowa
                const endTime = convertToSRTTime(word.end);  // End czas od ostatniego słowa

                // Dodanie do treści SRT
                srtContent += `${subtitleIndex}\n${startTime} --> ${endTime}\n${word.word}\n\n`;
                subtitleIndex++;
            })
        } else {
            entry?.segments.forEach((segment) => {
                const startTime = convertToSRTTime(segment.start);  // Start czas od pierwszego słowa
                const endTime = convertToSRTTime(segment.end);  // End czas od ostatniego słowa

                // Dodanie do treści SRT
                srtContent += `${subtitleIndex}\n${startTime} --> ${endTime}\n${segment.text.trim()}\n\n`;
                subtitleIndex++;
            })
        }
    });

    // Zapisanie pliku SRT
    fs.writeFileSync(path.dirname(filePath) + '/transcription-' + type + '.srt', srtContent);
}
