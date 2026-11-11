import type { IndexManager } from "langium";
import { isWorld, type World } from "./generated/ast.js";

/** Every loaded world of this name that is not a script: a world written in several files has one piece per file. */
export function loadedWorlds(name: string, indexManager: IndexManager | undefined): World[] {
    if (!indexManager) return [];
    const worlds: World[] = [];
    for (const description of indexManager.allElements("World")) {
        const node = description.node;
        if (isWorld(node) && !node.isReference && node.name === name && !worlds.includes(node)) worlds.push(node);
    }
    return worlds;
}

/**
 * This document's piece of a world first, then the pieces in the other files. The server merges the files into
 * one document before it runs the world; the editor checks each file alone and needs the others to know what
 * the world holds. A script holds no world items of its own, so it has no other pieces.
 */
export function worldParts(world: World, indexManager: IndexManager | undefined): World[] {
    if (world.isReference) return [world];
    return [world, ...loadedWorlds(world.name, indexManager).filter(other => other !== world)];
}
