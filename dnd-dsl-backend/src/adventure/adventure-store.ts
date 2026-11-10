import fs from 'fs';
import path from 'path';
import { isUsableFolderName } from '../image/map-image-store.js';

// Disk layout: <root>/<adventure>/<world>.dnd, with the world's other files beside it (<world>.state.json,
// .layout.json, .mapview.json), its named states in <world>.states/<name>.json, and the adventure's
// Maps.json and Maps/ images shared by all of its worlds. These functions only touch the disk.

export type AdventureEntry = { name: string; worlds: string[] };
export type WorldRef = { adventure: string; world: string };

const WORLD_SIDECARS = ['.state.json', '.layout.json', '.mapview.json'];

/** Thrown for a problem the caller caused (bad name, already exists, missing); the controller turns it into a 400. */
export class AdventureError extends Error {}

export function assertName(kind: string, name: unknown): asserts name is string {
    if (!isUsableFolderName(name)) throw new AdventureError(`"${String(name)}" is not a usable ${kind} name.`);
}

const worldFile = (root: string, { adventure, world }: WorldRef) => path.join(root, adventure, `${world}.dnd`);

export function listAdventures(root: string): AdventureEntry[] {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
            name: entry.name,
            worlds: fs.readdirSync(path.join(root, entry.name))
                .filter(file => file.endsWith('.dnd'))
                .map(file => file.slice(0, -'.dnd'.length))
                .sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** A new, empty world: the adventure folder is created when it is new. */
export function createWorld(root: string, target: WorldRef): void {
    assertName('adventure', target.adventure);
    assertName('world', target.world);
    const file = worldFile(root, target);
    if (fs.existsSync(file)) throw new AdventureError(`${target.adventure} / ${target.world} already exists.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `world "${target.world}"\n`, 'utf-8');
}

/**
 * Copies a world with everything that belongs to it. Another adventure also gets the adventure's map images,
 * unless that adventure already exists: its own Maps.json is kept.
 */
export function copyWorld(root: string, from: WorldRef, to: WorldRef): void {
    assertName('adventure', to.adventure);
    assertName('world', to.world);
    const source = worldFile(root, from);
    const target = worldFile(root, to);
    if (!fs.existsSync(source)) throw new AdventureError(`${from.adventure} / ${from.world} does not exist.`);
    if (fs.existsSync(target)) throw new AdventureError(`${to.adventure} / ${to.world} already exists.`);

    const newAdventure = !fs.existsSync(path.join(root, to.adventure));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    for (const suffix of WORLD_SIDECARS) {
        const sidecar = path.join(root, from.adventure, `${from.world}${suffix}`);
        if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, path.join(root, to.adventure, `${to.world}${suffix}`));
    }
    const states = statesDir(root, from);
    if (fs.existsSync(states)) fs.cpSync(states, statesDir(root, to), { recursive: true });

    if (newAdventure && from.adventure !== to.adventure) {
        for (const name of ['Maps.json', 'Maps']) {
            const maps = path.join(root, from.adventure, name);
            if (fs.existsSync(maps)) fs.cpSync(maps, path.join(root, to.adventure, name), { recursive: true });
        }
    }
}

export const statesDir = (root: string, { adventure, world }: WorldRef) => path.join(root, adventure, `${world}.states`);

export type NamedState = { name: string; savedAt: string };

export function saveNamedState(dir: string, name: string, content: unknown): void {
    assertName('state', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(content, null, 2), 'utf-8');
}

/** Newest first. */
export function listNamedStates(dir: string): NamedState[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({ name: file.slice(0, -'.json'.length), savedAt: fs.statSync(path.join(dir, file)).mtime.toISOString() }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function readNamedState(dir: string, name: string): unknown {
    assertName('state', name);
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) throw new AdventureError(`There is no saved state "${name}".`);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        throw new AdventureError(`The saved state "${name}" is not valid JSON.`);
    }
}
