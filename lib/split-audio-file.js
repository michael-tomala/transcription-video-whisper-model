import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';

// Funkcja do podziału pliku audio na kawałki (chunks) o maksymalnej wielkości w MB
export default function splitAudioFile(outputDir, maxSizeMB = 20) {
    const filePath = outputDir + '/audio.mp3';

    return new Promise((resolve, reject) => {
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024); // Oblicz rozmiar w MB

        if (fileSizeMB <= maxSizeMB) {
            return resolve([filePath]); // Jeśli plik jest mniejszy niż 20MB, zwróć go bez zmian
        }

        // Wyznaczamy bitrate pliku audio (w kbps)
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);

            const bitrate = metadata.format.bit_rate / 1000; // Bitrate w kbps

            if (!bitrate) {
                return reject(new Error('Nie udało się odczytać bitrate pliku audio.'));
            }

            // Obliczamy czas trwania chunku w sekundach
            const maxSizeKB = maxSizeMB * 1024; // Maksymalny rozmiar w KB
            const chunkDuration = Math.floor((maxSizeKB * 8) / bitrate); // Czas trwania w sekundach

            const tempDir = path.join(os.tmpdir(), 'audio_chunks');
            fs.mkdirSync(tempDir, { recursive: true });

            // Dzielimy plik audio na mniejsze pliki
            ffmpeg(filePath)
                .audioCodec('copy')
                .outputOptions([`-f segment`, `-segment_time ${chunkDuration}`])
                .output(`${tempDir}/chunk-%03d.mp3`)
                .on('end', () => {
                    fs.readdir(tempDir, (err, files) => {
                        if (err) reject(err);
                        const chunkFiles = files
                            .filter(file => file.startsWith('chunk'))
                            .map(file => path.join(tempDir, file));
                        resolve(chunkFiles);
                    });
                })
                .on('error', reject)
                .run();
        });
    });
}
