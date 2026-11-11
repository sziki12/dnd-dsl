import { isVariableDeclaration } from "../generated/ast.js";
import { decodeStatePath, resolveVariableContainer, statePathToNode, type StatePath } from "./dnd-dsl-state-path.js";

// The runtime state of a world is an overlay of values on top of what its source declares. These lay it onto the served
// (serialized) form of the world; the open world and the other worlds a world reads both go through them.

/**
 * Resolves `path` against a served world and, if it points at a non-computed variable, writes `value` into it. If the
 * leaf does not exist yet but its parent container does, creates it. False, and nothing written, when neither resolves.
 */
export function spliceOverlayValue(served: any, path: StatePath, value: unknown): boolean {
    const node = statePathToNode(served, path);
    if (node) {
        if (!isVariableDeclaration(node) || node.isComputed === 'computed') return false;
        (node as any).value = value;
        return true;
    }

    const containerInfo = resolveVariableContainer(served, path);
    if (!containerInfo) return false;
    containerInfo.variables.push({ $type: 'VariableDeclaration', target: containerInfo.target, value } as any);
    return true;
}

/** Lays every overlay entry onto a served world; returns the paths that no longer lead anywhere. */
export function applyOverlayToServed(served: any, overlay: Record<string, unknown>): StatePath[] {
    const stale: StatePath[] = [];
    for (const [encodedPath, value] of Object.entries(overlay)) {
        const path = decodeStatePath(encodedPath);
        if (!spliceOverlayValue(served, path, value)) stale.push(path);
    }
    return stale;
}
