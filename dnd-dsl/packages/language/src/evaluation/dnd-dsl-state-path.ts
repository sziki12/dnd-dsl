import type { AstNode } from "langium";
import {
    isEvent,
    isFunctionDeclaration,
    isLocation,
    isObjectDeclaration,
    isObjective,
    isQuest,
    isVariableDeclaration,
    type Location,
    type Model,
    type VariableDeclaration,
} from "../generated/ast.js";

// All Langium imports above are used only for their exported type guards / type
// annotations — no LSP-only services are touched — so this file is safe to import
// in both the Node.js backend and the browser frontend, same as dnd-dsl-reference.ts.

/**
 * One step in a name-based path to a declared entity or variable. Unlike Langium's
 * default `AstNodeLocator` paths (`locations@0/variables@1`), every segment here is
 * keyed by a user-authored NAME, so a path stays valid across `.dnd` edits that
 * reorder or insert siblings — the whole point of using this instead of a positional
 * `$ref` for anything that needs to survive being persisted across parses.
 */
export type StatePathSegment =
    | { kind: 'location'; name: string }
    | { kind: 'quest'; name: string }
    | { kind: 'objective'; questName: string; name: string }
    | { kind: 'event'; name: string }
    | { kind: 'function'; name: string }
    | { kind: 'variable'; target: string };

export type StatePath = StatePathSegment[];

/**
 * Canonical string key for a StatePath, for use as a JSON object key (state overlay
 * file, Map key, etc). Location/Quest/Event names are free-text STRINGs that may
 * legally contain spaces or any other delimiter a hand-rolled flattened format would
 * need to escape, so segments are kept as a plain array instead.
 */
export function encodeStatePath(path: StatePath): string {
    return JSON.stringify(path);
}

export function decodeStatePath(key: string): StatePath {
    return JSON.parse(key);
}

/**
 * Walks up from `node` to build its StatePath, stopping at the first named root
 * ancestor (Location/Quest/Objective/Event/FunctionDeclaration). Returns `undefined`
 * if `node` isn't reachable from one of those roots (e.g. a CodeBlock-local `let`
 * inside a function/event body — those aren't addressable state, see the
 * state-management plan's Phase C.3).
 */
export function nodeToStatePath(node: AstNode): StatePath | undefined {
    const segments: StatePathSegment[] = [];
    let current: AstNode | undefined = node;

    while (current) {
        if (isVariableDeclaration(current)) {
            // Only variables reachable through a Location's own `.variables` array (directly,
            // or nested inside an ObjectDeclaration) are persistent/addressable state. A
            // CodeBlock-local `let` or a FunctionDeclaration `param` is neither — those aren't
            // part of this plan (see Phase C.3), so bail out rather than returning a bogus path.
            const container = current.$container;
            if (!container || !(isLocation(container) || isObjectDeclaration(container))) return undefined;
            segments.unshift({ kind: 'variable', target: current.target ?? current.name ?? '' });
        } else if (isLocation(current)) {
            segments.unshift({ kind: 'location', name: current.name });
            return segments;
        } else if (isObjective(current)) {
            segments.unshift({ kind: 'objective', questName: current.$container.name, name: current.name });
            return segments;
        } else if (isQuest(current)) {
            segments.unshift({ kind: 'quest', name: current.name });
            return segments;
        } else if (isEvent(current)) {
            segments.unshift({ kind: 'event', name: current.name });
            return segments;
        } else if (isFunctionDeclaration(current)) {
            segments.unshift({ kind: 'function', name: current.name });
            return segments;
        }
        // ObjectDeclaration (and anything else) contributes no segment of its own —
        // it's a transparent wrapper; the owning VariableDeclaration already
        // contributed the segment on the previous loop iteration.
        current = current.$container;
    }

    return undefined;
}

/** Resolves a StatePath back to the AST node it addresses, or `undefined` if it
 *  no longer resolves (e.g. the `.dnd` source renamed/removed the target since the
 *  path was recorded). Callers decide how to treat that — see the state-management
 *  plan's Phase A.3 error-handling convention. */
export function statePathToNode(model: Model, path: StatePath): AstNode | undefined {
    const [head, ...rest] = path;
    if (!head) return undefined;

    let root: AstNode | undefined;
    switch (head.kind) {
        case 'location':
            root = findLocationByName(model.World.locations, head.name);
            break;
        case 'quest':
            root = model.World.quests.find(q => q.name === head.name);
            break;
        case 'objective': {
            const quest = model.World.quests.find(q => q.name === head.questName);
            root = quest?.objectives.find(o => o.name === head.name);
            break;
        }
        case 'event':
            root = model.World.events.find(e => e.name === head.name);
            break;
        case 'function':
            root = model.World.functions.find(f => f.name === head.name);
            break;
        case 'variable':
            return undefined; // a 'variable' segment can never be the path head
    }

    return rest.reduce<AstNode | undefined>((node, seg) => {
        if (!node || seg.kind !== 'variable') return undefined;
        const variables = getVariablesArray(node);
        const decl = variables?.find(v => (v.target ?? v.name) === seg.target);
        if (!decl) return undefined;
        const value = unwrapExpression(decl.value);
        return isObjectDeclaration(value) ? value : decl;
    }, root);
}

/**
 * Resolves everything in `path` except its final 'variable' segment, and returns the
 * `.variables` array that segment's VariableDeclaration would live in — Location.variables,
 * or a nested ObjectDeclaration's own .variables — plus the leaf's target name.
 *
 * This is what lets ASSIGN_VARIABLE create a variable that doesn't exist yet: the leaf
 * variable itself is allowed to be missing, but its PARENT container is not — a real
 * Location/Quest/etc, or an already-declared `object` block must already resolve.
 * Deliberately does NOT auto-vivify a missing Location or a missing intermediate
 * `object` block; only a missing leaf variable is creatable.
 */
export function resolveVariableContainer(model: Model, path: StatePath): { variables: VariableDeclaration[]; target: string } | undefined {
    const last = path[path.length - 1];
    if (!last || last.kind !== 'variable') return undefined;

    const parentPath = path.slice(0, -1);
    if (parentPath.length === 0) return undefined; // a lone 'variable' segment can't be a path head

    const container = statePathToNode(model, parentPath);
    if (!container) return undefined;

    const variables = getVariablesArray(container);
    if (!variables) return undefined;

    return { variables, target: last.target };
}

/** Langium's `... infers Expression` grammar chain (Bool/Comparison/Int/PrimaryExpression)
 *  wraps a value in one or more generic `{ $type: 'Expression', exp: ... }` passthrough
 *  nodes whenever no operator is present at that level — e.g. `let Resources = object ... end`
 *  parses `Resources.value` as a stack of `Expression` wrappers around the real
 *  `ObjectDeclaration` node, not the ObjectDeclaration directly. Same unwrap
 *  `LangiumInterpreterService.evaluateExpression` already does for the same reason. */
export function unwrapExpression(node: AstNode | undefined): AstNode | undefined {
    while (node && node.$type === 'Expression') {
        node = (node as unknown as { exp?: AstNode }).exp;
    }
    return node;
}

function findLocationByName(locations: Location[], name: string): Location | undefined {
    for (const location of locations) {
        if (location.name === name) return location;
        const found = findLocationByName(location.sublocations, name);
        if (found) return found;
    }
    return undefined;
}

function getVariablesArray(node: AstNode): VariableDeclaration[] | undefined {
    if (isLocation(node)) return node.variables;
    if (isObjectDeclaration(node)) return node.variables;
    return undefined;
}
