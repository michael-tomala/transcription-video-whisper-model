import fs from 'fs'

// Funkcja do łączenia słów w dłuższe frazy
function mergeWordsToPhrases(words, minDuration = 1000) {
    let phrases = [];
    let aggregatedStart = 0
    let aggregatedEnd = 0
    let aggregatedPhrase = ''

    let currentStart = 0, currentEnd = 0, currentPhrase = ''

    words.forEach((word, index) => {
        currentStart = aggregatedEnd ? aggregatedStart : word.start;
        currentEnd = word.end;
        currentPhrase = aggregatedEnd ? aggregatedPhrase + ' ' + word.word : word.word;

        if ((currentEnd - currentStart) * 1000 < minDuration) {
            if (words[index + 1]?.start && (words[index + 1]?.start - currentStart) * 1000 >= minDuration) {
                // Jeśli możemy rozciągnać trwanie do początku przyszłego słowa i spełni minimum to tak robimy
                phrases.push({
                    start: currentStart,
                    end: currentStart + (minDuration / 1000),
                    word: currentPhrase
                });
                aggregatedEnd = 0
            } else {
                aggregatedStart = currentStart
                aggregatedEnd = currentEnd
                aggregatedPhrase = currentPhrase
                // phrases.push({start: currentStart, end: currentEnd, text: 'ZAKROTKA:' + currentPhrase});
            }
        } else {
            phrases.push({start: currentStart, end: currentEnd, word: currentPhrase});
            aggregatedEnd = 0
        }

    });

    // Dodanie ostatniej frazy
    if (aggregatedEnd) {
        phrases.push({start: currentStart, end: currentEnd, word: currentPhrase});
    }

    return phrases;
}

// Funkcja do generowania pliku SRT na podstawie wczytanego pliku
export default async function generateReformatedTranscription(outputDir, minDuration) {
    const filePath = outputDir + '/transcription.json'
    const data = fs.readFileSync(filePath, 'utf8')

    // Generowanie treści pliku SRT
    const transcriptionData = JSON.parse(data).map((entry) => {
        const words = mergeWordsToPhrases(entry.words, Number(minDuration));  // Minimalny czas wyświetlania na frazę: 1.5 sekundy
        return {
            ...entry,
            words
        }
    });

    fs.writeFileSync(outputDir + '/transcription-reformatted.json', JSON.stringify(transcriptionData, null, 2));
}
