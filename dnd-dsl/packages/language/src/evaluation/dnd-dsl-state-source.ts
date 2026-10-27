import { isObjective, isQuest, isVariableDeclaration, Model, Objective, Quest } from "../generated/ast.js";
import { decodeStatePath, StatePath, statePathToNode } from "./dnd-dsl-state-path.js";
import { CstNode, GrammarUtils } from "langium";

export type StateSourceChange = {
    kind: "changed" | "inserted";   // value replaced in place / whole line added
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
    offset: number, 
    end: number, 
    text: string, 
    path: StatePath, 
    original: string | undefined 
};

export function renderSourceWithState(
    model: Model,
    source: string,
    overlay: Record<string, unknown>,
): StateSourceView
{
    //Concrete modification
    const modifications: Modification[] = [];
    const stale: StatePath[] = [];

    //Find thechanges in the overlay
    for (const [encoded, value] of Object.entries(overlay)) {
        const path = decodeStatePath(encoded);
        const node = statePathToNode(model, path);
        if (!node) {
            stale.push(path);
            continue;
        }
        if(isVariableDeclaration(node) && node.value && node.value.$cstNode) { 

            if(node.isComputed) {
                //Leave computed variables as are
                continue;
            }
            else {
                let [offset, end] = [node.value.$cstNode.offset, node.value.$cstNode.end]
                let renderedValue = renderValue(value, node.enumType?.$refText)
                const original = source.slice(offset, end);
                if (renderedValue !== original) {
                    //If the value has changed, add a modification
                    modifications.push({ offset, end, text: renderedValue, path, original });
                }
            }
        }
        else if (isVariableDeclaration(node) && node.value && !node.value.$cstNode && node.$container) {
            const parent = node.$container;
            if(isQuest(parent) || isObjective(parent)) {
                const anchor = insertionAnchor(parent);
                if (anchor) {
                    const eol = source.includes("\r\n") ? "\r\n" : "\n";
                    const indent = lineIndent(source, anchor.node.offset) + (anchor.isName ? "    " : "");
                    const text = `${eol}${indent}let ${node.target} = ${renderValue(value, node.enumType?.$refText)}`;
                    modifications.push({ offset: anchor.node.end, end: anchor.node.end, text, path, original: undefined });
                }
            }
        }
    }

    //Changes to be reported in the view
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
        // Record the change
        if (!mod.original) {
            changes.push({ kind: "inserted", line: line + 1, path: mod.path });
        }
        else {
            changes.push({ kind: "changed", line, path: mod.path, original: mod.original });
        }
        line += countNewlines(mod.text);
        cursor = mod.end;
    }
    document += source.slice(cursor);
    return {
        text: document,
        changes,
        stale,
    };
}

function insertionAnchor(owner: Quest | Objective): { node: CstNode, isName: boolean } | undefined {
    // drops the built-in Status
    const sourceVars = owner.variables.filter(v => v.$cstNode);
    const node = sourceVars[sourceVars.length - 1]?.$cstNode
        ?? GrammarUtils.findNodeForProperty(owner.$cstNode, "description");
    if (node) return { node, isName: false };
    const name = GrammarUtils.findNodeForProperty(owner.$cstNode, "name");
    return name ? { node: name, isName: true } : undefined;
}

function lineIndent(source: string, offset: number): string {
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    return /^[ \t]*/.exec(source.slice(lineStart, offset))![0];
}

function countNewlines(text: string): number {
    return text.split("\n").length - 1;
}

function renderValue(value: unknown, enumName?: string): string {
    if (typeof value === 'string') {
        return enumName ? `${enumName}::${value}` : JSON.stringify(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(v => renderValue(v, enumName)).join(', ')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value).map(([k, v]) => `\tlet ${k} = ${renderValue(v)}`);
        return `object ${entries.join(' ')} end`;
    }
    return 'null';
}
