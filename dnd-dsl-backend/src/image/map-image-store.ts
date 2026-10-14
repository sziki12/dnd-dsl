import {
    BadRequestException,
    NotFoundException,
    PayloadTooLargeException,
    UnsupportedMediaTypeException,
} from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { isSafeSegment } from '../common/safe-segment.js';

// A location's map image lives at <adventure>/Maps/<location>/<file>, and <adventure>/Maps.json maps
// location name -> file name. Uploading writes the new file, points Maps.json at it, then deletes the old one.

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export type ImageExtension = 'png' | 'jpg' | 'webp' | 'gif';

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

/** What an image really is, from its first bytes (the declared content type is not trusted). SVG is deliberately not accepted. */
export function detectImageType(bytes: Buffer): ImageExtension | undefined {
    const startsWith = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
    const text = (from: number, value: string) => bytes.length >= from + value.length && bytes.toString('latin1', from, from + value.length) === value;

    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
    if (startsWith(0xff, 0xd8, 0xff)) return 'jpg';
    if (text(0, 'GIF87a') || text(0, 'GIF89a')) return 'gif';
    if (text(0, 'RIFF') && text(8, 'WEBP')) return 'webp';
    return undefined;
}

const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
};

/** The content type to serve a stored file with, from its extension. */
export function contentTypeFor(fileName: string): string {
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * An upload is the image itself as the request body, so it must not look like something Express would parse
 * (JSON, a form): that would consume the stream before it can be read. Only image types and a plain byte stream pass.
 */
export function isImageUploadType(contentType: string | undefined): boolean {
    return /^(image\/[\w.+-]+|application\/octet-stream)\s*(;|$)/i.test(contentType ?? '');
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A location name that can be a folder name on every platform the app runs on. */
export function isUsableFolderName(name: unknown): name is string {
    return (
        isSafeSegment(name) &&
        name.length <= 120 &&
        !/[<>:"|?*\x00-\x1f]/.test(name) &&
        !/[. ]$/.test(name) &&
        !WINDOWS_RESERVED.test(name)
    );
}

function mappingFile(adventurePath: string): string {
    return path.join(adventurePath, 'Maps.json');
}

function readMapping(adventurePath: string): Record<string, unknown> {
    const file = mappingFile(adventurePath);
    if (!fs.existsSync(file)) return {};
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        // A hand-broken Maps.json is treated as empty; the next upload replaces it.
        return {};
    }
}

function writeFileAtomically(file: string, content: string | Buffer): void {
    const temp = `${file}.tmp`;
    try {
        fs.writeFileSync(temp, content);
        fs.renameSync(temp, file);
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

/** The stored image of a location, when there is one and Maps.json names a safe, existing file. */
export function resolveMapImage(adventurePath: string, location: string): { path: string; fileName: string } | undefined {
    if (!isUsableFolderName(location)) return undefined;
    const mapping = readMapping(adventurePath);
    const fileName = hasOwn(mapping, location) ? mapping[location] : undefined;
    if (!isSafeSegment(fileName)) return undefined;
    const imagePath = path.join(adventurePath, 'Maps', location, fileName);
    return fs.existsSync(imagePath) ? { path: imagePath, fileName } : undefined;
}

/**
 * Stores `bytes` as the location's map image and returns the file name. The previous image file is deleted
 * (only when it is a plain file name inside the location's own folder), and every other location is left alone.
 */
export function saveMapImage(adventurePath: string, location: string, bytes: Buffer): string {
    if (!isUsableFolderName(location)) throw new BadRequestException('This location name cannot be used as a folder name.');
    if (bytes.length === 0) throw new BadRequestException('The image is empty.');
    const extension = detectImageType(bytes);
    if (!extension) throw new UnsupportedMediaTypeException('Only PNG, JPEG, WebP and GIF images can be used.');
    if (!fs.existsSync(adventurePath)) throw new NotFoundException('The adventure folder was not found.');

    const folder = path.join(adventurePath, 'Maps', location);
    fs.mkdirSync(folder, { recursive: true });
    const fileName = `map.${extension}`;
    writeFileAtomically(path.join(folder, fileName), bytes);

    const mapping = readMapping(adventurePath);
    const previous = hasOwn(mapping, location) ? mapping[location] : undefined;
    // defineProperty keeps a location called "__proto__" or "constructor" an ordinary key.
    Object.defineProperty(mapping, location, { value: fileName, enumerable: true, writable: true, configurable: true });
    writeFileAtomically(mappingFile(adventurePath), JSON.stringify(mapping, null, '\t'));

    if (isSafeSegment(previous) && previous !== fileName) {
        const old = path.join(folder, previous);
        if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    return fileName;
}

/** Reads a request body, refusing more than `maxBytes` without buffering the excess. */
export function readBody(stream: Readable, maxBytes: number): Promise<Buffer> {
    // Already read to the end (or closed) by something else: nothing more will arrive, so do not wait for it.
    if (stream.readableEnded || stream.destroyed) return Promise.resolve(Buffer.alloc(0));
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;

        const settle = (action: () => void) => {
            if (settled) return;
            settled = true;
            stream.removeListener('data', onData);
            stream.removeListener('end', onEnd);
            stream.removeListener('error', onError);
            stream.removeListener('close', onClose);
            action();
        };
        const onData = (chunk: Buffer | string) => {
            const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            total += buffer.length;
            if (total > maxBytes) {
                // Let the rest of the body drain unread, so the client still gets this response.
                stream.resume();
                settle(() => reject(new PayloadTooLargeException(`The image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`)));
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => settle(() => resolve(Buffer.concat(chunks)));
        const onError = (error: Error) => settle(() => reject(error));
        const onClose = () => settle(() => reject(new BadRequestException('The upload was interrupted.')));

        stream.on('data', onData);
        stream.on('end', onEnd);
        stream.on('error', onError);
        stream.on('close', onClose);
    });
}
