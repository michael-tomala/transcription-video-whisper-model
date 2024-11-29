
// 4. Łączenie transkrypcji z wszystkich kawałków
export default function combineTranscriptions(transcriptions) {
    let combinedText = '';
    transcriptions.forEach(transcription => {
        combinedText += transcription.text + '\n'; // Łączenie tekstów transkrypcji
    });
    return combinedText;
}