import { isVariableDeclaration, Model } from "../generated/ast.js";
import { decodeStatePath, StatePath, statePathToNode } from "./dnd-dsl-state-path.js";

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

export function renderSourceWithState(
    model: Model,
    source: string,
    overlay: Record<string, unknown>,
): StateSourceView
{
    var document = '';
    for (const [encoded, value] of Object.entries(overlay)) {
        const path = decodeStatePath(encoded);
        const node = statePathToNode(model, path);
        let text = '';
        if(node && isVariableDeclaration(node) && node.value && node.value.$cstNode) { 

            if(node.isComputed) {
                //Leave computed variables as are
                text = node.value.$cstNode.text;
            }
            else {
                let [offset, end] = [node.value.$cstNode.offset, node.value.$cstNode.end]
                let renderedValue = renderValue(value, node)
                text = source.slice(0, offset) + renderedValue + source.slice(end);
            }
        }
        else if(node && node.$cstNode) {
            //This renders the entire tree multiple times
            text = node.$cstNode.text;
        }

        document += text;
    }
    return {
        text: document,
        changes: [],
        stale: [],
    };
}

function renderValue(value: unknown, node: any): string {
    if (typeof value === 'string') {
        if (node && isVariableDeclaration(node) && node.enumType) {
            return `"${node.enumType}::${value}"`;
        }
        else {
            return `"${value}"`;
        }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    } else if (Array.isArray(value)) {
        return `[${value.map(v => renderValue(v, node)).join(', ')}]`;
    } else if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value).map(([k, v]) => `${k}: ${renderValue(v, node)}`);
        return `{ ${entries.join(', ')} }`;
    }
    else {
        return JSON.stringify(value);
    }

    return 'null';
}
