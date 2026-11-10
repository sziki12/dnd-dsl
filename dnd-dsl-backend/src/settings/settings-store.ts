import fs from 'fs';
import os from 'os';
import path from 'path';

// The settings live outside the repo and the save folder, so they survive updates and are never committed:
// the chosen source folder and the world that was open last.

export type LastWorld = { adventure: string; world: string };
export type Settings = { sourceFolder?: string; lastWorld?: LastWorld };

/** DND_DSL_SETTINGS names the file directly; the tests and the harness use it. */
export function settingsFilePath(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    home: string = os.homedir(),
): string {
    if (env.DND_DSL_SETTINGS) return env.DND_DSL_SETTINGS;
    const base = platform === 'win32' ? (env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
        : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
        : (env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
    return path.join(base, 'dnd-dsl', 'settings.json');
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** A missing or hand-broken file is treated as empty; the next write replaces it. */
export function readSettings(file: string): Settings {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return {};
    }
    if (typeof raw !== 'object' || raw === null) return {};

    const { sourceFolder, lastWorld } = raw as Record<string, unknown>;
    const last = (typeof lastWorld === 'object' && lastWorld !== null ? lastWorld : {}) as Record<string, unknown>;
    const settings: Settings = {};
    if (isText(sourceFolder)) settings.sourceFolder = sourceFolder;
    if (isText(last.adventure) && isText(last.world)) settings.lastWorld = { adventure: last.adventure, world: last.world };
    return settings;
}

/** Written to a temporary file first, so a crash cannot leave half a settings file. */
export function writeSettings(file: string, settings: Settings): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(temporary, file);
}
