import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { spawn } from 'child_process';
import fs from 'fs';
import { EmptyFileSystem } from 'langium';
import { createDndDslServices } from '@dnd-language/index.js';
import { setWorldName } from '@dnd-language/world-files.js';
import os from 'os';
import path from 'path';
import { SettingsService } from '../settings/settings.service.js';
import { FileService } from '../file/file.service.js';
import { WorldStateService } from '../world-state/world-state.service.js';
import { CommandService } from '../command/command.service.js';
import { StateSyncGateway } from '../state-sync/state-sync.gateway.js';
import type { StateOverlayFile } from '../world-state/state-overlay.types.js';
import {
    AdventureError, assertName, copyWorld, createWorld, listAdventures, listNamedStates, readNamedState, saveNamedState,
    statesDir, type AdventureEntry, type NamedState, type WorldRef,
} from './adventure-store.js';
import { listFolders, windowsDrives, type FolderListing } from './folder-browser.js';

export type ActiveWorld = { adventure?: string; world?: string; loaded: boolean; sourceFolder: string | null };

/**
 * Which adventure and world the server has loaded, and everything the File menu does around it.
 * The loaded world is one for the whole server, so opening another one tells every connected page.
 */
@Injectable()
export class AdventureService implements OnApplicationBootstrap {
    private adventure: string | undefined;
    private world: string | undefined;
    private loaded = false;

    constructor(
        private readonly settingsService: SettingsService,
        private readonly fileService: FileService,
        private readonly worldStateService: WorldStateService,
        private readonly commandService: CommandService,
        private readonly stateSyncGateway: StateSyncGateway,
    ) {}

    private get root(): string {
        return this.settingsService.requireSourceFolder();
    }

    /** Opens the world that was open when the server last ran, so a restart does not leave every page without one. */
    async onApplicationBootstrap(): Promise<void> {
        const last = this.settingsService.lastWorld;
        if (!this.settingsService.sourceFolder || !last) return;
        try {
            await this.open(last.adventure, last.world);
        } catch (e) {
            console.warn(`Could not reopen ${last.adventure} / ${last.world}:`, e instanceof Error ? e.message : e);
        }
    }

    /** Before anything is loaded the names are the remembered ones, which may not exist any more. */
    active(): ActiveWorld {
        const last = this.settingsService.lastWorld;
        return {
            adventure: this.adventure ?? last?.adventure,
            world: this.world ?? last?.world,
            loaded: this.loaded,
            sourceFolder: this.settingsService.sourceFolder ?? null,
        };
    }

    markLoaded(adventure: string, world: string): void {
        this.adventure = adventure;
        this.world = world;
        this.loaded = true;
        this.settingsService.setLastWorld({ adventure, world });
    }

    folders(requested: string | undefined): FolderListing {
        return listFolders(requested, os.homedir(), process.platform === 'win32' ? windowsDrives : undefined);
    }

    /** Unloads the open world: its files belong to the old folder. A new folder starts with nothing open. */
    setSourceFolder(folder: string, create: boolean): void {
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new AdventureError('Give the full path of a folder.');
        const chosen = path.resolve(folder);
        if (!fs.existsSync(chosen)) {
            if (!create) throw new AdventureError(`"${chosen}" does not exist.`);
            try {
                fs.mkdirSync(chosen, { recursive: true });
            } catch {
                throw new AdventureError(`Could not create "${chosen}".`);
            }
        } else if (!fs.statSync(chosen).isDirectory()) {
            throw new AdventureError(`"${chosen}" is not a folder.`);
        }
        if (chosen === this.settingsService.sourceFolder) return;

        this.settingsService.setSourceFolder(chosen);
        this.worldStateService.unload();
        this.commandService.resetHistory();
        this.adventure = undefined;
        this.world = undefined;
        this.loaded = false;
        this.stateSyncGateway.broadcastSourceFolder(chosen);
    }

    list(): AdventureEntry[] {
        return listAdventures(this.root);
    }

    /** A world that fails to parse throws before anything changes, so the previous one stays loaded. */
    async open(adventure: string, world: string): Promise<void> {
        assertName('adventure', adventure);
        assertName('world', world);
        const { files } = this.fileService.getWorldFiles(adventure, world);
        await this.worldStateService.loadFromFiles(files, world, this.fileService.getStateFilePath(adventure, world));
        this.markLoaded(adventure, world);
        this.commandService.resetHistory();
        this.stateSyncGateway.broadcastActiveWorld(adventure, world);
        this.commandService.notifyWorldReloaded();
    }

    async create(target: WorldRef): Promise<void> {
        createWorld(this.root, target);
        await this.open(target.adventure, target.world);
    }

    /** Copies the open world, with its state, layout, map views, saved states and images, and opens the copy. */
    async saveAs(target: WorldRef): Promise<void> {
        assertName('world', target.world);
        copyWorld(this.root, this.openWorld(), target, text => setWorldName(this.parserServices(), text, target.world));
        await this.open(target.adventure, target.world);
    }

    listStates(): NamedState[] {
        return listNamedStates(statesDir(this.root, this.openWorld()));
    }

    saveState(name: string): void {
        saveNamedState(statesDir(this.root, this.openWorld()), name, this.worldStateService.snapshotOverlayFile());
    }

    /** Replaces the current state; undo and redo start over because their steps belong to the state that was replaced. */
    loadState(name: string): void {
        const saved = readNamedState(statesDir(this.root, this.openWorld()), name) as StateOverlayFile;
        if (typeof saved !== 'object' || saved === null || typeof saved.entries !== 'object' || saved.entries === null) {
            throw new AdventureError(`The saved state "${name}" is not a state file.`);
        }
        this.worldStateService.applyOverlayFile(saved);
        this.worldStateService.persistOverlay();
        this.commandService.resetHistory();
        this.commandService.notifyWorldReloaded();
    }

    /** Shows the source folder in the machine's file explorer: the server runs on the DM's own machine. */
    reveal(): Promise<void> {
        if (!fs.existsSync(this.root)) throw new AdventureError('The source folder does not exist.');
        const [command, args] = process.platform === 'win32' ? ['explorer.exe', [this.root]]
            : process.platform === 'darwin' ? ['open', [this.root]]
            : ['xdg-open', [this.root]];
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { detached: true, stdio: 'ignore' });
            child.once('error', () => reject(new AdventureError(`Could not start "${command}".`)));
            child.once('spawn', () => { child.unref(); resolve(); });
        });
    }

    private parser: ReturnType<typeof createDndDslServices>['DndDsl'] | undefined;

    /** Only the parser is needed, to find the world line of a file. */
    private parserServices() {
        return (this.parser ??= createDndDslServices(EmptyFileSystem).DndDsl);
    }

    private openWorld(): WorldRef {
        const { adventure, world, loaded } = this.active();
        if (!loaded || !adventure || !world || !this.worldStateService.getModel()) throw new AdventureError('No world is open.');
        return { adventure, world };
    }
}
