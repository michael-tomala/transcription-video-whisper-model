// Rejestr procesów potomnych (whisper-cli, ffmpeg). Worker bywa ubijany sygnałem,
// a bez tego narzędzia zostałyby sierotami mielącymi CPU w tle długo po zadaniu.
// Trzymamy to w osobnym module, bo dzieci spawnuje kilka miejsc: transkrypcja
// lokalna, wyodrębnianie audio i dzielenie pliku na kawałki.
const activeChildren = new Set();

// Działa zarówno dla ChildProcess, jak i dla polecenia fluent-ffmpeg -
// oba udostępniają kill(signal).
export function trackChild(child) {
    activeChildren.add(child);
    return child;
}

export function untrackChild(child) {
    activeChildren.delete(child);
}

export function killActiveChildren() {
    for (const child of activeChildren) {
        try {
            child.kill('SIGTERM');
        } catch {
            // proces już zniknął
        }
    }
    activeChildren.clear();
}
