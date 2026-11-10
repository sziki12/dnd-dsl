import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import fs from 'fs';
import { ConfigurationService } from '../configuration/configuration.service.js';
import { FileService } from '../file/file.service.js';
import { WorldStateService } from '../world-state/world-state.service.js';
import { CommandService } from '../command/command.service.js';
import { StateSyncGateway } from '../state-sync/state-sync.gateway.js';
import type { StateOverlayFile } from '../world-state/state-overlay.types.js';
import {
    AdventureError, assertName, copyWorld, createWorld, listAdventures, listNamedStates, readNamedState, saveNamedState,
    statesDir, type AdventureEntry, type NamedState, type WorldRef,
} from './adventure-store.js';

export type ActiveWorld = { adventure?: string; world?: string; loaded: boolean };

/**
 * Which adventure and world the server has loaded, and everything the File menu does around it.
 * The loaded world is one for the whole server, so opening another one tells every connected page.
 */
@Injectable()
export class AdventureService {
    private adventure: string | undefined;
    private world: string | undefined;
    private loaded = false;

    constructor(
        private readonly configurationService: ConfigurationService,
        private readonly fileService: FileService,
        private readonly worldStateService: WorldStateService,
        private readonly commandService: CommandService,
        private readonly stateSyncGateway: StateSyncGateway,
    ) {}

    private get root(): string {
        return this.configurationService.DefaultFilePath!;
    }

    /** Before anything is loaded this is the world named in config.json. */
    active(): ActiveWorld {
        return {
            adventure: this.adventure ?? this.configurationService.AdventureName,
            world: this.world ?? this.configurationService.WorldName,
            loaded: this.loaded,
        };
    }

    markLoaded(adventure: string, world: string): void {
        this.adventure = adventure;
        this.world = world;
        this.loaded = true;
    }

    list(): AdventureEntry[] {
        return listAdventures(this.root);
    }

    /** A world that fails to parse throws before anything changes, so the previous one stays loaded. */
    async open(adventure: string, world: string): Promise<void> {
        assertName('adventure', adventure);
        assertName('world', world);
        if (!fs.existsSync(this.fileService.getDnDFilePath(adventure, world))) {
            throw new AdventureError(`${adventure} / ${world} does not exist.`);
        }
        await this.worldStateService.loadFromFile(
            this.fileService.getDnDFilePath(adventure, world),
            this.fileService.getStateFilePath(adventure, world),
        );
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
        copyWorld(this.root, this.openWorld(), target);
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

    /** Shows the save folder in the machine's file explorer: the server runs on the DM's own machine. */
    reveal(): Promise<void> {
        if (!fs.existsSync(this.root)) throw new AdventureError('The save folder does not exist.');
        const [command, args] = process.platform === 'win32' ? ['explorer.exe', [this.root]]
            : process.platform === 'darwin' ? ['open', [this.root]]
            : ['xdg-open', [this.root]];
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { detached: true, stdio: 'ignore' });
            child.once('error', () => reject(new AdventureError(`Could not start "${command}".`)));
            child.once('spawn', () => { child.unref(); resolve(); });
        });
    }

    private openWorld(): WorldRef {
        const { adventure, world, loaded } = this.active();
        if (!loaded || !adventure || !world || !this.worldStateService.getModel()) throw new AdventureError('No world is open.');
        return { adventure, world };
    }
}
