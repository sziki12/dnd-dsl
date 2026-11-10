import fs from 'fs';
import path from 'path';
import { AdventureError } from './adventure-store.js';

export type FolderListing = {
    path: string;
    /** False for a path that is typed but not there yet: choosing it then creates it. */
    exists: boolean;
    /** Null at the top of a drive or of the file system. */
    parent: string | null;
    folders: string[];
    /** Only on Windows and only at the top of a drive, to move to another drive. */
    drives?: string[];
};

/** The folders (never files, never hidden ones) directly inside `requested`, or inside `home` when none is given. */
export function listFolders(requested: string | undefined, home: string, listDrives?: () => string[]): FolderListing {
    const wanted = requested?.trim() ? requested.trim() : home;
    if (!path.isAbsolute(wanted)) throw new AdventureError('Give the full path of a folder.');

    const folder = path.resolve(wanted);
    const above = path.dirname(folder);
    const parent = above === folder ? null : above;
    const drives = parent === null && listDrives ? listDrives() : undefined;
    const base = { path: folder, parent, ...(drives && { drives }) };

    if (!fs.existsSync(folder)) return { ...base, exists: false, folders: [] };
    if (!fs.statSync(folder).isDirectory()) throw new AdventureError(`"${folder}" is a file, not a folder.`);

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
        throw new AdventureError(`"${folder}" cannot be read.`);
    }
    const folders = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
    return { ...base, exists: true, folders };
}

/** The drive letters that exist, as `C:\`. */
export function windowsDrives(): string[] {
    const drives: string[] = [];
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
        const root = `${String.fromCharCode(code)}:\\`;
        if (fs.existsSync(root)) drives.push(root);
    }
    return drives;
}
