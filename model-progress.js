// FileLoader.loaded counts decoded bytes. HTTP Content-Length may count gzip bytes.
// Transfer progress is a byte count; 100% is reserved for completed preparation.
export function describeModelDownload(progress) {
    const bytes = Number.isFinite(progress.loaded) ? Math.max(0, progress.loaded) : 0;
    return `Se descarcă modelul… ${(bytes / 1048576).toFixed(1)} MiB`;
}
