import { AstUtils, GrammarUtils, type AstNode, type CstNode } from "langium";
import {
    isFaction, isLocation, isNpc, isObjective, isObjectDeclaration, isParty, isQuest, isVariableDeclaration,
    type Model, type StringVal, type VariableDeclaration,
} from "../generated/ast.js";
import {
    decodeStatePath, encodeStatePath, nodeToStatePath, resolveVariableContainer, statePathToNode, type StatePath,
} from "./dnd-dsl-state-path.js";
import { objectiveStatusPath, questStatusPath, STATUS_VARIABLE } from "./dnd-dsl-status.js";

export type StateSourceChange = {
    kind: "changed" | "inserted" | "computed";   // value replaced in place / whole line added / current value noted after a computed variable
    line: number;                   // 1-based line in the OUTPUT text
    path: StatePath;
    original?: string;              // source text of the old value (kind "changed" only)
};

export type StateSourceView = {
    text: string;
    changes: StateSourceChange[];
    stale: StatePath[];             // overlay entries whose path no longer resolves
};

type Modification = {
    kind: StateSourceChange["kind"];
    offset: number;
    end: number;
    text: string;
    path: StatePath;
    original?: string;
};

/**
 * `computedValue` evaluates the variable at a state path against the live world state; with it, every
 * `let computed` in the source gets its current value as a trailing `// = value` comment, and the
 * formula stays as written. Without it, computed variables are left alone.
 */
export function renderSourceWithState(
    model: Model,
    source: string,
    overlay: Record<string, unknown>,
    computedValue?: (path: StatePath) => unknown,
): StateSourceView {
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const unit = source.includes("\n\t") ? "\t" : "    ";
    const modifications: Modification[] = [];
    const stale: StatePath[] = [];

    const insertion = (owner: AstNode, target: string, rendered: string, path: StatePath): Modification | undefined => {
        const anchor = insertionAnchor(owner);
        if (!anchor) return undefined;
        const offset = lineEnd(source, anchor.node.end);
        const indent = lineIndent(source, anchor.node.offset) + (anchor.isHeader ? unit : "");
        return { kind: "inserted", offset, end: offset, text: `${eol}${indent}let ${target} = ${rendered}`, path };
    };

    // Pushed before any insertion so, when a new line follows a computed variable, the comment stays on its line.
    if (computedValue) {
        for (const node of AstUtils.streamAllContents(model.World)) {
            if (!isVariableDeclaration(node) || node.isComputed !== "computed" || !node.$cstNode) continue;
            const path = nodeToStatePath(node);
            if (!path) continue;
            const offset = lineEnd(source, node.$cstNode.end);
            modifications.push({ kind: "computed", offset, end: offset, text: ` // = ${describeValue(computedValue(path))}`, path });
        }
    }

    // The built-in Status of every quest and objective has no source text, so it is always added as a line.
    for (const quest of model.World.quests) {
        for (const owner of [quest, ...quest.objectives]) {
            const decl = owner.variables.find(v => v.target === STATUS_VARIABLE && !v.$cstNode);
            if (!decl) continue;
            const path = isQuest(owner) ? questStatusPath(owner.name) : objectiveStatusPath(owner.$container.name, owner.name);
            const key = encodeStatePath(path);
            const value = key in overlay ? overlay[key] : (decl.value as unknown as StringVal).val;
            const mod = insertion(owner, STATUS_VARIABLE, renderValue(value), path);
            if (mod) modifications.push(mod);
        }
    }

    for (const [encoded, value] of Object.entries(overlay)) {
        const path = decodeStatePath(encoded);
        const node = statePathToNode(model, path);

        if (node) {
            if (!isVariableDeclaration(node) || node.isComputed) continue;
            if (!node.value?.$cstNode) continue; // the built-in Status, added above
            const { offset, end } = node.value.$cstNode;
            const rendered = renderValue(value, node);
            const original = source.slice(offset, end);
            if (!sameAsSource(original, value, rendered)) {
                modifications.push({ kind: "changed", offset, end, text: rendered, path, original });
            }
            continue;
        }

        // No declaration: a variable that exists only in the overlay, if its container still resolves.
        const leaf = path[path.length - 1];
        const owner = resolveVariableContainer(model, path) ? statePathToNode(model, path.slice(0, -1)) : undefined;
        const mod = owner && leaf.kind === "variable" ? insertion(owner, leaf.target, renderValue(value), path) : undefined;
        if (mod) modifications.push(mod);
        else stale.push(path);
    }

    const changes: StateSourceChange[] = [];
    let document = "";
    let cursor = 0;
    let line = 1;
    modifications.sort((a, b) => a.offset - b.offset);
    for (const mod of modifications) {
        if (mod.offset < cursor) continue;

        const before = source.slice(cursor, mod.offset);
        document += before + mod.text;
        line += countNewlines(before);
        if (mod.kind === "inserted") {
            changes.push({ kind: "inserted", line: line + 1, path: mod.path });
        } else {
            changes.push({ kind: mod.kind, line, path: mod.path, original: mod.original });
        }
        line += countNewlines(mod.text);
        cursor = mod.end;
    }
    document += source.slice(cursor);

    return { text: document, changes, stale };
}

/** The last piece of the owner's own text that sits before where its variables go, so a new `let` lands after it. */
function insertionAnchor(owner: AstNode): { node: CstNode; isHeader: boolean } | undefined {
    const cst = owner.$cstNode;
    if (!cst) return undefined;

    const header = isObjectDeclaration(owner)
        ? GrammarUtils.findNodeForKeyword(cst, "object")
        : GrammarUtils.findNodeForProperty(cst, "name");

    const members: CstNode[] = [];
    if (isLocation(owner)) {
        if (owner.entry?.$cstNode) members.push(owner.entry.$cstNode);
        for (const exit of owner.exits) if (exit.$cstNode) members.push(exit.$cstNode);
    } else if (isQuest(owner) || isObjective(owner) || isNpc(owner) || isFaction(owner) || isParty(owner)) {
        const description = GrammarUtils.findNodeForProperty(cst, "description");
        if (description) members.push(description);
    }
    const variables = (owner as { variables?: VariableDeclaration[] }).variables ?? [];
    for (const variable of variables) if (variable.$cstNode) members.push(variable.$cstNode);

    if (members.length > 0) {
        return { node: members.reduce((latest, next) => (next.end > latest.end ? next : latest)), isHeader: false };
    }
    return header ? { node: header, isHeader: true } : undefined;
}

/** Offset of the end of the line `offset` is on, before its line break, so a trailing comment stays with its line. */
function lineEnd(source: string, offset: number): number {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    return newline > 0 && source[newline - 1] === "\r" ? newline - 1 : newline;
}

function lineIndent(source: string, offset: number): string {
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    return /^[ \t]*/.exec(source.slice(lineStart, offset))![0];
}

function countNewlines(text: string): number {
    return text.split("\n").length - 1;
}

/** Same value written differently, such as 'Bob' in the source and "Bob" from the overlay. */
function sameAsSource(original: string, value: unknown, rendered: string): boolean {
    if (rendered === original) return true;
    return typeof value === "string" && /^(["']).*\1$/s.test(original) && original.slice(1, -1) === value;
}

/** A computed value for a comment: one line, `?` when it could not be evaluated. */
function describeValue(value: unknown): string {
    if (value === undefined || value === null) return "?";
    if (Array.isArray(value)) return `[${value.map(describeValue).join(", ")}]`;
    if (typeof value === "object") {
        return `{ ${Object.entries(value).map(([key, item]) => `${key}: ${describeValue(item)}`).join(", ")} }`;
    }
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function renderValue(value: unknown, decl?: VariableDeclaration): string {
    const stateName = decl?.stateType?.$refText;
    const members = decl?.stateType?.ref?.values.map(v => v.name);
    return render(value, stateName, members);
}

function render(value: unknown, stateName?: string, members?: string[]): string {
    if (typeof value === "string") {
        return stateName && members?.includes(value) ? `${stateName}::${value}` : JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.map(v => render(v, stateName, members)).join(", ")}]`;
    return JSON.stringify(JSON.stringify(value) ?? "");
}
