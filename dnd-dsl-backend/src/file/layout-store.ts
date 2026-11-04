import fs from 'fs';

// Saved node positions of every map live in one JSON file per world: { "<location name or $world>": { "<node>": { x, y } } }.
// The frontend owns the shape; this only keeps the maps apart.

export type Layout = Record<string, { x: number; y: number }>;

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function readAll(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) return {};
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return isPlainObject(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** The saved positions of one map, or {} when there are none. */
export function readLayout(filePath: string, key: string): Layout {
    if (typeof key !== 'string') return {};
    const all = readAll(filePath);
    const entry = hasOwn(all, key) ? all[key] : undefined;
    return isPlainObject(entry) ? (entry as Layout) : {};
}

/** Saves one map's positions, leaving the others as they are. */
export function writeLayout(filePath: string, key: string, positions: Layout): void {
    const all = readAll(filePath);
    // defineProperty keeps a key called "__proto__" or "constructor" an ordinary entry.
    Object.defineProperty(all, key, { value: positions, enumerable: true, writable: true, configurable: true });
    fs.writeFileSync(filePath, JSON.stringify(all, null, 2), 'utf-8');
}
