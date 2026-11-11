import { AstUtils, type AstNode } from "langium";
import { isForeignRefItem, isLocationExit, isRefChain, type Model } from "../generated/ast.js";
import type { SerializedModel } from "./dnd-dsl-serialized-types.js";
import { statePathToNode, type StatePath } from "./dnd-dsl-state-path.js";

// A world can read a variable of an entity in another world of its adventure (`world "Other" . npc "Ann" . Gold`) and
// have an exit that leads into one (`exit "Door" to world "Other" -> "Hall"`). The other world is never loaded into this
// world's workspace (its names would collide with this world's), so none of this is a cross-reference: the server gives
// the code the other world's served state, and checks every name against it when this world loads.

export type ForeignWorlds = {
    /** The served state (overlay applied) of another world of the adventure, or why it cannot be read. */
    read(world: string): { served: SerializedModel } | { problem: string };
};

export type ForeignProblem = { node: AstNode; message: string };

/** The other worlds that the code under `root` reads or leads into; `ownWorld` is not one of them. */
export function foreignWorldNames(root: AstNode, ownWorld?: string): string[] {
    const names = new Set<string>();
    for (const node of AstUtils.streamAllContents(root)) {
        if (isForeignRefItem(node)) names.add(node.world);
        else if (isLocationExit(node) && node.foreignWorld !== undefined) names.add(node.foreignWorld);
    }
    if (ownWorld !== undefined) names.delete(ownWorld);
    return [...names];
}

/** The state path of `kind "name" . member . member`. */
export function foreignPath(kind: string, name: string, members: string[]): StatePath {
    return [{ kind, name } as StatePath[number], ...members.map(target => ({ kind: 'variable', target }) as StatePath[number])];
}

/** Every name in `model` that points into another world and is not there. */
export function checkForeignReferences(model: Model, foreign: ForeignWorlds): ForeignProblem[] {
    const problems: ForeignProblem[] = [];
    const servedOf = (world: string, node: AstNode): SerializedModel | undefined => {
        const result = foreign.read(world);
        if ('problem' in result) {
            problems.push({ node, message: result.problem });
            return undefined;
        }
        return result.served;
    };

    for (const node of AstUtils.streamAllContents(model)) {
        if (isForeignRefItem(node)) {
            if (node.world === model.World.name) continue; // the validator reports it
            const served = servedOf(node.world, node);
            if (!served) continue;
            const chain = node.$container;
            const members = isRefChain(chain) ? chain.rest.map(item => item.val.val.$refText) : [];
            if (!statePathToNode(served as unknown as Model, foreignPath(node.kind, node.name, []))) {
                problems.push({ node, message: `World "${node.world}" has no ${node.kind} "${node.name}".` });
                continue;
            }
            for (let i = 1; i <= members.length; i++) {
                if (!statePathToNode(served as unknown as Model, foreignPath(node.kind, node.name, members.slice(0, i)))) {
                    problems.push({ node, message: `The ${node.kind} "${node.name}" of world "${node.world}" has no variable ${members.slice(0, i).join(' . ')}.` });
                    break;
                }
            }
        } else if (isLocationExit(node) && node.foreignWorld !== undefined) {
            if (node.foreignWorld === model.World.name) {
                problems.push({ node, message: `That is this world: lead to the location itself, without 'world "${node.foreignWorld}"'.` });
                continue;
            }
            const served = servedOf(node.foreignWorld, node);
            if (!served) continue;
            const path = node.foreignPath.map(name => ({ kind: 'location', name }) as StatePath[number]);
            if (!statePathToNode(served as unknown as Model, path)) {
                problems.push({ node, message: `World "${node.foreignWorld}" has no location "${node.foreignPath.join('" -> "')}".` });
            }
        }
    }
    return problems;
}
