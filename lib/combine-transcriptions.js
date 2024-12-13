export default function combineTranscriptions(transcriptions) {
    let combinedTranscription = {
        text: '',
        segments: [],
        words: []
    };

    let timeOffset = 0;

    transcriptions.forEach((transcription, index) => {
        // Dodaj tekst z separatorem
        combinedTranscription.text += (index > 0 ? ' ' : '') + transcription.text;

        // Dostosuj czasy segmentów
        if (transcription.segments) {
            const adjustedSegments = transcription.segments.map(segment => ({
                ...segment,
                start: segment.start + timeOffset,
                end: segment.end + timeOffset,
                words: segment.words ? segment.words.map(word => ({
                    ...word,
                    start: word.start + timeOffset,
                    end: word.end + timeOffset
                })) : []
            }));
            combinedTranscription.segments.push(...adjustedSegments);
        }

        // Dostosuj czasy słów na poziomie głównym (jeśli istnieją)
        if (transcription.words) {
            const adjustedWords = transcription.words.map(word => ({
                ...word,
                start: word.start + timeOffset,
                end: word.end + timeOffset
            }));
            combinedTranscription.words.push(...adjustedWords);
        }

        // Aktualizuj offset o rzeczywistą długość pliku audio
        timeOffset += transcription.audio_duration;
    });

    return combinedTranscription;
}