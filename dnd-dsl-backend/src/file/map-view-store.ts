import { BadRequestException } from '@nestjs/common';
import fs from 'fs';
import { isSafeSegment } from '../common/safe-segment.js';

// Per-location map view settings (colours, labels, node size, ...) live in one JSON file per world:
// { "<location name>": { ...settings } }. The frontend owns the shape and sanitises it on load, so this
// only keeps the entries apart and refuses anything that is not a small plain object.

export type MapViewEntry = Record<string, unknown>;

/** A location's settings are a few hundred bytes; this only stops a runaway client. */
const MAX_ENTRY_CHARS = 20_000;

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

const isPlainObject = (value: unknown): value is MapViewEntry =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export { isSafeSegment };

function readAll(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) return {};
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return isPlainObject(parsed) ? parsed : {};
    } catch {
        // A half-written or hand-broken file is treated as empty; the next save replaces it.
        return {};
    }
}

/** The saved settings of one location, or {} when there are none. */
export function readMapView(filePath: string, location: string): MapViewEntry {
    if (typeof location !== 'string') return {};
    const all = readAll(filePath);
    const entry = hasOwn(all, location) ? all[location] : undefined;
    return isPlainObject(entry) ? entry : {};
}

/** Saves one location's settings. An empty object removes the entry (default settings are never stored). */
export function writeMapView(filePath: string, location: string, settings: unknown): void {
    if (typeof location !== 'string' || location.length === 0) throw new BadRequestException('A location is required.');
    if (!isPlainObject(settings)) throw new BadRequestException('Map view settings must be an object.');
    if (JSON.stringify(settings).length > MAX_ENTRY_CHARS) throw new BadRequestException('Map view settings are too large.');

    const all = readAll(filePath);
    if (Object.keys(settings).length === 0) {
        delete all[location];
    } else {
        // defineProperty keeps a location called "__proto__" or "constructor" an ordinary key.
        Object.defineProperty(all, location, { value: settings, enumerable: true, writable: true, configurable: true });
    }

    // Write beside the file and rename, so a crash mid-write cannot leave a truncated settings file.
    const temp = `${filePath}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(all, null, 2), 'utf-8');
        fs.renameSync(temp, filePath);
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}
