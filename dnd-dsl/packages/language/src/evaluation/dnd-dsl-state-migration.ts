import type { Model } from "../generated/ast.js";
import { canonicalStatePath, decodeStatePath, encodeStatePath, type StatePath } from "./dnd-dsl-state-path.js";

// A sublocation used to be addressed by its own name alone, `[Entrance, Torches]`. It is now addressed through its
// parents, `[Dungeon 1, Entrance, Torches]` (see `StatePathSegment`), so state saved before that carries the old form.
// These bring such state to the new form when a world is loaded.

/**
 * The overlay with every key written the current way. An entry whose location no longer resolves keeps its key (the
 * stale-entry handling reports it), and when an old and a new key stand for the same variable the new one wins.
 */
export function canonicalOverlayEntries(model: Model, entries: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const renamed: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(entries)) {
        const canonical = canonicalKey(model, key);
        if (canonical === key) result[key] = value;
        else renamed.push([canonical, value]);
    }
    for (const [key, value] of renamed) {
        if (!(key in result)) result[key] = value;
    }
    return result;
}

/** The reminder with the address it is pinned to written the current way; one without a pin, or whose location no longer resolves, is returned as it is. */
export function canonicalReminder<T extends { pin?: StatePath }>(model: Model, reminder: T): T {
    const pin = reminder.pin && canonicalStatePath(model, reminder.pin);
    return pin ? { ...reminder, pin } : reminder;
}

function canonicalKey(model: Model, key: string): string {
    let path: StatePath;
    try {
        path = decodeStatePath(key);
    } catch {
        return key;
    }
    const canonical = Array.isArray(path) ? canonicalStatePath(model, path) : undefined;
    return canonical ? encodeStatePath(canonical) : key;
}
