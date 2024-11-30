import ffmpeg from 'fluent-ffmpeg';

// 1. Wyodrębnianie audio z wideo
export default function extractAudio(videoPath, outputDir) {
    const audioPath = './' + outputDir + '/audio.mp3'; // Ścieżka do pliku audio
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .output(audioPath)
            .on('end', () => resolve(audioPath))
            .on('error', reject)
            .run();
    });
}