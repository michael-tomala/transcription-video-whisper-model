import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';

// 2. Funkcja do podziału pliku audio na kawałki (chunks) o maksymalnej wielkości 20MB
export default function splitAudioFile(filePath, maxSizeMB = 20) {
    return new Promise((resolve, reject) => {
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024); // Oblicz rozmiar w MB

        if (fileSizeMB <= maxSizeMB) {
            return resolve([filePath]); // Jeśli plik jest mniejszy niż 20MB, zwróć go bez zmian
        }

        const chunks = [];
        const chunkSize = Math.floor(fileSizeMB / maxSizeMB);
        const tempDir = path.join(os.tmpdir(), 'audio_chunks');
        fs.mkdirSync(tempDir, {recursive: true});

        // Dzielimy plik audio na mniejsze pliki
        ffmpeg(filePath)
            .audioCodec('copy')
            .outputOptions([`-f segment`, `-segment_time ${chunkSize}`]) // Podziel na mniejsze pliki
            .output(`${tempDir}/chunk-%03d.mp3`)
            .on('end', () => {
                fs.readdir(tempDir, (err, files) => {
                    if (err) reject(err);
                    const chunkFiles = files.filter(file => file.startsWith('chunk')).map(file => path.join(tempDir, file));
                    resolve(chunkFiles);
                });
            })
            .on('error', reject)
            .run();
    });
}