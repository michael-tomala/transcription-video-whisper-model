import transcribeWithOpenAI from './whisper-openai.js';
import transcribeWithLocalWhisper from './whisper-local.js';

export const BACKENDS = ['openai', 'local'];

// Wybór backendu transkrypcji. Oba zwracają ten sam kontrakt
// ({text, segments, words, audio_duration}), więc dalsza część pipeline'u ich nie rozróżnia.
export default function transcribeAudio(audioPath, options = {}) {
    const {backend = 'openai'} = options;

    if (backend === 'local') {
        return transcribeWithLocalWhisper(audioPath, options);
    }

    return transcribeWithOpenAI(audioPath, options);
}
