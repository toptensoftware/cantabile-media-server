import path from 'node:path';

let mimeTypes = {
    "apng": "image/apng",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".pdf": "application/pdf",
};

// Helper to get mimetype of a file from its extension
export function mimeTypeFromFile(filename)
{
    if (!filename)
        return null;
    return mimeTypes[path.extname(filename).toLowerCase()];
}