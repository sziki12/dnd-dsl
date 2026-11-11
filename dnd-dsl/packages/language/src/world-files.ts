import { GrammarUtils } from "langium";
import type { DndDslServices } from "./dnd-dsl-module.js";
import type { Model } from "./generated/ast.js";

// A world may be written in several files that all start with `world "Name"`. The World rule accepts its header again
// where the next file begins, so the files glued one after the other are a valid single world, and the repeated
// header ends the last item of the file before (a location would otherwise take the next file's first `let`). Running
// that one document means nothing else in the system has to know about files; this module only keeps track of
// where each line came from.

export type WorldHeader = {
    name: string;
    isReference: boolean;
    /** Where the quoted name starts and ends in the text, so it can be replaced. */
    nameStart: number;
    end: number;
};

export type WorldFileText = { file: string; text: string };
export type FileLine = { file: string; line: number };
export type MergedWorld = {
    text: string;
    /** The file and the line in it (both 1-based lines) of a line of `text`. */
    fileAt(line: number): FileLine;
};
export type WorldFileProblem = { file: string; message: string };
export type MergeResult = { ok: true; merged: MergedWorld } | { ok: false; problems: WorldFileProblem[] };

/** The `world "Name"` header of a file, or undefined when the file does not start with one. */
export function worldHeader(services: DndDslServices, text: string): WorldHeader | undefined {
    const world = (services.parser.LangiumParser.parse<Model>(text).value as Model | undefined)?.World;
    const name = GrammarUtils.findNodeForProperty(world?.$cstNode, "name");
    if (!world || !name || world.name === undefined) return undefined;
    return { name: world.name, isReference: !!world.isReference, nameStart: name.offset, end: name.end };
}

const lineAt = (text: string, offset: number): number => {
    let line = 1;
    for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) line++;
    return line;
};

/**
 * Glues the files of the world `worldName` into one source, one after the other, each whole. Every file has to say
 * `world "<worldName>"`; a problem is reported against the file it is in.
 */
export function mergeWorldFiles(services: DndDslServices, worldName: string, files: WorldFileText[]): MergeResult {
    if (files.length === 0) return { ok: false, problems: [{ file: "", message: `The world "${worldName}" has no .dnd files.` }] };

    const problems: WorldFileProblem[] = [];
    files.forEach(({ file, text }) => {
        const header = worldHeader(services, text);
        if (!header) {
            problems.push({ file, message: `The file does not start with: world "${worldName}"` });
        } else if (header.isReference) {
            problems.push({ file, message: `A script (reference world) is not part of a world; the file has to start with: world "${worldName}"` });
        } else if (header.name !== worldName) {
            problems.push({ file, message: `The file declares world "${header.name}", but this world is "${worldName}". Change the line to: world "${worldName}"` });
        }
    });
    if (problems.length > 0) return { ok: false, problems };

    const segments: { file: string; mergedLine: number }[] = [];
    let text = "";
    files.forEach((entry, i) => {
        if (i > 0) text += "\n";
        segments.push({ file: entry.file, mergedLine: lineAt(text, text.length) });
        text += entry.text;
    });

    return {
        ok: true,
        merged: {
            text,
            fileAt: line => {
                const segment = [...segments].reverse().find(s => s.mergedLine <= line) ?? segments[0];
                return { file: segment.file, line: line - segment.mergedLine + 1 };
            },
        },
    };
}

/** The same text with the world's name in its header replaced; a file without a header is returned as it is. */
export function setWorldName(services: DndDslServices, text: string, name: string): string {
    const header = worldHeader(services, text);
    return header ? `${text.slice(0, header.nameStart)}"${name}"${text.slice(header.end)}` : text;
}
