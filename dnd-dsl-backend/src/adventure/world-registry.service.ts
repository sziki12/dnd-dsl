import { Injectable } from '@nestjs/common';
import fs from 'fs';
import { DndDslParseError, parseWorld, stringifyNode } from '@dnd-cli/main.js';
import { applyOverlayToServed } from '@dnd-language/evaluation/dnd-dsl-overlay.js';
import { canonicalOverlayEntries } from '@dnd-language/evaluation/dnd-dsl-state-migration.js';
import type { ForeignWorlds } from '@dnd-language/evaluation/dnd-dsl-foreign.js';
import { FileService } from '../file/file.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { predefinedFunctionsAsMap } from '../predefined/predefined-functions.js';
import type { StateOverlayFile } from '../world-state/state-overlay.types.js';
import { listAdventures } from './adventure-store.js';

type Read = ReturnType<ForeignWorlds['read']>;

export const describeError = (e: unknown): string =>
    e instanceof DndDslParseError ? e.diagnostics.map(d => d.message).join('; ') : e instanceof Error ? e.message : String(e);

/**
 * The other worlds of an adventure, for a world that reads them (see dnd-dsl-foreign.ts). Each is parsed on its own and
 * given its own saved state, once per load of the world that mentions it; a world it reads in turn is not followed.
 */
@Injectable()
export class WorldRegistry {
    constructor(
        private readonly fileService: FileService,
        private readonly settingsService: SettingsService,
    ) {}

    /** What a load of `activeWorld` hands to `parseWorld`: given the worlds it mentions, their state or why it cannot be read. */
    preparer(adventure: string, activeWorld: string): (worlds: string[]) => Promise<ForeignWorlds> {
        return async worlds => {
            const present = listAdventures(this.settingsService.requireSourceFolder()).find(a => a.name === adventure)?.worlds ?? [];
            const known = new Map<string, Read>();
            for (const world of new Set(worlds)) {
                known.set(world, world === activeWorld || !present.includes(world)
                    ? { problem: `There is no world "${world}" in the adventure "${adventure}".` }
                    : await this.snapshot(adventure, world));
            }
            return { read: world => known.get(world) ?? { problem: `The world "${world}" was not read.` } };
        };
    }

    private async snapshot(adventure: string, world: string): Promise<Read> {
        try {
            const { files } = this.fileService.getWorldFiles(adventure, world);
            const { model } = await parseWorld(files, world);
            const served = JSON.parse(stringifyNode(model));
            served.predefinedFunctions = predefinedFunctionsAsMap;

            const statePath = this.fileService.getStateFilePath(adventure, world);
            if (fs.existsSync(statePath)) {
                const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as StateOverlayFile;
                applyOverlayToServed(served, canonicalOverlayEntries(model, saved.entries ?? {}));
            }
            return { served };
        } catch (e) {
            return { problem: `The world "${world}" cannot be read: ${describeError(e)}` };
        }
    }
}
