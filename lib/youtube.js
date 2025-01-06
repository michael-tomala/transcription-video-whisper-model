import youtubedl from 'youtube-dl-exec';
import path from 'path'

export const downloadAudioFromYoutube = async (url, outputDir) => {
    return new Promise((resolve, reject) => {
        try {
            const outputFile = path.join(outputDir, 'audio.mp3');

            const download = youtubedl.exec(url, {
                extractAudio: true,
                audioFormat: 'mp3',
                output: outputFile,
                progress: true // Włącza pokazywanie postępu
            });

            // Obsługa zakończenia
            download.on('close', () => {
                console.log('Download completed!');
                resolve()
            });

            // Obsługa błędów
            download.on('error', (error) => {
                console.error('Error:', error);
                reject()
            });

        } catch (error) {
            console.error('Error:', error);
            reject()
        }

    })
};


export const extractYouTubeId = (url) => {
    if (!url) return null;

    // Obsługiwane formaty:
    // - youtube.com/watch?v=ID
    // - youtu.be/ID
    // - youtube.com/v/ID
    // - youtube.com/embed/ID
    // - youtube.com/shorts/ID
    // - youtube.com/?v=ID
    // - youtube.com/live/ID

    const patterns = [
        /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
        /youtube\.com\/shorts\/([^"&?\/\s]{11})/i,
        /youtube\.com\/live\/([^"&?\/\s]{11})/i
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    return null;
}


export const isYoutubeUrl = (videoPath) => {

    // Wzorce różnych formatów linków YouTube
    const youtubePatterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+(&\S*)?$/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+$/
    ];

    // Sprawdź czy videoPath to string
    if (typeof videoPath !== 'string') {
        return true; // Nie jest linkiem YT, bo nie jest nawet stringiem
    }

    // Sprawdź czy pasuje do któregokolwiek wzorca YouTube
    const isYouTubeUrl = youtubePatterns.some(pattern => pattern.test(videoPath));

    return !!isYouTubeUrl;
}
