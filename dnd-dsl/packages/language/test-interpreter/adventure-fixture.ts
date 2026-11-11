import { afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { interpreter, variableOf } from "./harness";
import { WorldStateService } from "../../../../dnd-dsl-backend/src/world-state/world-state.service";
import { CommandService } from "../../../../dnd-dsl-backend/src/command/command.service";
import { AdventureService } from "../../../../dnd-dsl-backend/src/adventure/adventure.service";
import { FileService } from "../../../../dnd-dsl-backend/src/file/file.service";
import { SettingsService } from "../../../../dnd-dsl-backend/src/settings/settings.service";

export const WORLD = `world "W"\nlocation "Town"\n    let Alarm = 0\n`;
export const OTHER = `world "Other"\nlocation "Town"\n    let Alarm = 100\n`;
export const CLIENT = "test-client";
export const alarmPath = [{ kind: "location", name: "Town" }, { kind: "variable", target: "Alarm" }] as const;

const dirs: string[] = [];
/** Folders to remove after each test of the file that calls this. */
export function removeFoldersAfterEach(): void {
    afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
}
export const trackFolder = (folder: string): string => { dirs.push(folder); return folder; };

/** A fresh server over the same settings file, as after a restart. */
export function server(settingsFile: string, root: string) {
    process.env.DND_DSL_SETTINGS = settingsFile;
    const settings = new SettingsService();
    const sent: string[] = [];
    const gateway = {
        broadcastState: () => sent.push("state"),
        broadcastActiveWorld: (adventure: string, world: string) => sent.push(`active ${adventure}/${world}`),
        broadcastSourceFolder: (folder: string) => sent.push(`source ${folder}`),
        isController: () => true,
    };
    const files = new FileService(settings);
    const worldState = new WorldStateService(interpreter);
    const commands = new CommandService(worldState, interpreter, gateway as any);
    const adventures = new AdventureService(settings, files, worldState, commands, gateway as any);
    const served = () => worldState.getWorldState();
    const alarm = () => variableOf(served(), "Town", "Alarm");
    const setAlarm = (newValue: number) => commands.execute({ type: "ASSIGN_VARIABLE", path: alarmPath as any, newValue });
    const file = (...parts: string[]) => path.join(root, ...parts);
    return { adventures, worldState, commands, sent, served, alarm, setAlarm, file, root, settings, files };
}

export function seed(root: string) {
    fs.mkdirSync(path.join(root, "Adv"), { recursive: true });
    fs.writeFileSync(path.join(root, "Adv", "W.dnd"), WORLD);
    fs.writeFileSync(path.join(root, "Adv", "Other.dnd"), OTHER);
}

export function setup(options: { chooseFolder?: boolean } = {}) {
    const root = trackFolder(fs.mkdtempSync(path.join(os.tmpdir(), "dnd-adventure-")));
    const home = trackFolder(fs.mkdtempSync(path.join(os.tmpdir(), "dnd-settings-")));
    seed(root);
    const settingsFile = path.join(home, "settings.json");
    const first = server(settingsFile, root);
    if (options.chooseFolder !== false) first.settings.setSourceFolder(root);
    return { ...first, settingsFile, restart: () => server(settingsFile, root) };
}
