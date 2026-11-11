import { BadRequestException } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { isUsableFolderName } from '../image/map-image-store.js';

// Disk layout: a world is <root>/<adventure>/<world>.dnd, or a folder <root>/<adventure>/<world>/ whose .dnd files are
// equal parts of it. Beside the world, in both cases: <world>.state.json, .layout.json, .mapview.json, its named states
// in <world>.states/<name>.json; and the adventure's Maps.json and Maps/ images are shared by all of its worlds.
// These functions only touch the disk.

export type AdventureEntry = { name: string; worlds: string[] };
export type WorldRef = { adventure: string; world: string };

const WORLD_SIDECARS = ['.state.json', '.layout.json', '.mapview.json'];

/** A problem the caller caused (bad name, already exists, missing): Nest answers it with a 400 and this message. */
export class AdventureError extends BadRequestException {}

export function assertName(kind: string, name: unknown): asserts name is string {
    if (!isUsableFolderName(name)) throw new AdventureError(`"${String(name)}" is not a usable ${kind} name.`);
}

const DND = '.dnd';
const byName = (a: string, b: string) => a.localeCompare(b);
const worldFile = (root: string, { adventure, world }: WorldRef) => path.join(root, adventure, `${world}${DND}`);
const worldFolder = (root: string, { adventure, world }: WorldRef) => path.join(root, adventure, world);

const dndFilesIn = (folder: string): string[] =>
    fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(DND)).map(e => e.name).sort(byName);

const isFolder = (folder: string) => fs.existsSync(folder) && fs.statSync(folder).isDirectory();

export type WorldFiles = { kind: 'file' | 'folder'; files: string[] };

/** The files a world is written in, as full paths: its one file, or the .dnd files of its folder. */
export function worldFiles(root: string, ref: WorldRef): WorldFiles {
    assertName('adventure', ref.adventure);
    assertName('world', ref.world);
    const file = worldFile(root, ref);
    const folder = worldFolder(root, ref);
    const inFolder = isFolder(folder) ? dndFilesIn(folder) : [];
    const label = `${ref.adventure} / ${ref.world}`;
    if (fs.existsSync(file) && inFolder.length > 0) {
        throw new AdventureError(`${label} is both a file (${ref.world}${DND}) and a folder (${ref.world}) of .dnd files. Remove or rename one of them.`);
    }
    if (fs.existsSync(file)) return { kind: 'file', files: [file] };
    if (inFolder.length > 0) return { kind: 'folder', files: inFolder.map(name => path.join(folder, name)) };
    throw new AdventureError(`${label} does not exist.`);
}

/** One of a world's files by its name, or the only one when no name is given. */
export function worldFilePath(root: string, ref: WorldRef, fileName: string | undefined): string {
    const { files } = worldFiles(root, ref);
    if (fileName === undefined || fileName === '') {
        if (files.length === 1) return files[0];
        throw new AdventureError(`${ref.world} is written in ${files.length} files; say which one.`);
    }
    const found = files.find(file => path.basename(file) === fileName);
    if (!found) throw new AdventureError(`${ref.world} has no file "${fileName}".`);
    return found;
}

const worldExists = (root: string, ref: WorldRef) =>
    fs.existsSync(worldFile(root, ref)) || (isFolder(worldFolder(root, ref)) && dndFilesIn(worldFolder(root, ref)).length > 0);

export function listAdventures(root: string): AdventureEntry[] {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => {
            const adventure = path.join(root, entry.name);
            const worlds = new Set<string>();
            for (const inside of fs.readdirSync(adventure, { withFileTypes: true })) {
                if (inside.isFile() && inside.name.endsWith(DND)) worlds.add(inside.name.slice(0, -DND.length));
                else if (inside.isDirectory() && !inside.name.startsWith('.') && dndFilesIn(path.join(adventure, inside.name)).length > 0) worlds.add(inside.name);
            }
            return { name: entry.name, worlds: [...worlds].sort(byName) };
        })
        .sort((a, b) => byName(a.name, b.name));
}

export type AdventureWorldFiles = { world: string; files: { name: string; content: string }[]; problem?: string };

/**
 * Every world of an adventure with the text of its files, for an editor that shows them all. A world whose files cannot
 * be told (both a file and a folder) is reported on its own and does not stop the rest.
 */
export function readAdventureFiles(root: string, adventure: string): AdventureWorldFiles[] {
    assertName('adventure', adventure);
    const entry = listAdventures(root).find(a => a.name === adventure);
    if (!entry) throw new AdventureError(`There is no adventure "${adventure}".`);
    return entry.worlds.map(world => {
        try {
            const { files } = worldFiles(root, { adventure, world });
            return { world, files: files.map(file => ({ name: path.basename(file), content: fs.readFileSync(file, 'utf-8') })) };
        } catch (e) {
            if (e instanceof AdventureError) return { world, files: [], problem: e.message };
            throw e;
        }
    });
}

/** A new, empty world: the adventure folder is created when it is new. */
export function createWorld(root: string, target: WorldRef): void {
    assertName('adventure', target.adventure);
    assertName('world', target.world);
    const file = worldFile(root, target);
    if (worldExists(root, target)) throw new AdventureError(`${target.adventure} / ${target.world} already exists.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `world "${target.world}"\n`, 'utf-8');
}

/**
 * Adds a file to a world and returns its name. A world that is one file first becomes a folder holding that file
 * (under its own name); its state, layout and other files stay beside it.
 */
export function addWorldFile(root: string, ref: WorldRef, fileName: string): string {
    const name = fileName.endsWith(DND) ? fileName.slice(0, -DND.length) : fileName;
    assertName('file', name);
    const current = worldFiles(root, ref);
    const created = `${name}${DND}`;
    const taken = current.kind === 'file' ? [`${ref.world}${DND}`] : current.files.map(file => path.basename(file));
    if (taken.includes(created)) throw new AdventureError(`${ref.world} already has a file ${created}.`);

    const folder = worldFolder(root, ref);
    if (current.kind === 'file') {
        fs.mkdirSync(folder);
        fs.renameSync(current.files[0], path.join(folder, `${ref.world}${DND}`));
    }
    fs.writeFileSync(path.join(folder, created), `world "${ref.world}"\n`, 'utf-8');
    return created;
}

/**
 * Copies a world with everything that belongs to it, a world of several files as several files. `rewrite` changes
 * the text of every copied .dnd file (the copy has to say its own name). Another adventure also gets the adventure's
 * map images, unless that adventure already exists: its own Maps.json is kept.
 */
export function copyWorld(root: string, from: WorldRef, to: WorldRef, rewrite: (text: string) => string = text => text): void {
    assertName('adventure', to.adventure);
    assertName('world', to.world);
    const source = worldFiles(root, from);
    if (worldExists(root, to)) throw new AdventureError(`${to.adventure} / ${to.world} already exists.`);

    const newAdventure = !fs.existsSync(path.join(root, to.adventure));
    fs.mkdirSync(path.join(root, to.adventure), { recursive: true });
    if (source.kind === 'file') {
        fs.writeFileSync(worldFile(root, to), rewrite(fs.readFileSync(source.files[0], 'utf-8')), 'utf-8');
    } else {
        fs.mkdirSync(worldFolder(root, to));
        for (const file of source.files) {
            fs.writeFileSync(path.join(worldFolder(root, to), path.basename(file)), rewrite(fs.readFileSync(file, 'utf-8')), 'utf-8');
        }
    }
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
