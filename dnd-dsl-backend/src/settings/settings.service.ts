import { BadRequestException, Injectable } from '@nestjs/common';
import fs from 'fs';
import { readSettings, settingsFilePath, writeSettings, type LastWorld, type Settings } from './settings-store.js';

@Injectable()
export class SettingsService {
    private readonly file = settingsFilePath();
    private settings: Settings = readSettings(this.file);

    /** Undefined while none is chosen, and when the chosen folder no longer exists. */
    get sourceFolder(): string | undefined {
        const folder = this.settings.sourceFolder;
        return folder && isFolder(folder) ? folder : undefined;
    }

    requireSourceFolder(): string {
        const folder = this.sourceFolder;
        if (!folder) throw new BadRequestException('No source folder is chosen.');
        return folder;
    }

    get lastWorld(): LastWorld | undefined {
        return this.settings.lastWorld;
    }

    /** A new folder forgets the last world: it belonged to the old one. */
    setSourceFolder(folder: string): void {
        this.settings = { sourceFolder: folder };
        this.save();
    }

    setLastWorld(world: LastWorld): void {
        this.settings = { ...this.settings, lastWorld: world };
        this.save();
    }

    // Settings that cannot be written (a read-only profile) only cost the memory between restarts.
    private save(): void {
        try {
            writeSettings(this.file, this.settings);
        } catch (e) {
            console.warn(`Could not save the settings to ${this.file}:`, e);
        }
    }
}

function isFolder(folder: string): boolean {
    try {
        return fs.statSync(folder).isDirectory();
    } catch {
        return false;
    }
}
