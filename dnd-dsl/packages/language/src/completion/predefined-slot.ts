import { CompletionItemKind } from "vscode-languageserver";
import type { CompletionItem } from "vscode-languageserver";
import { PREDEFINED_SIGNATURES } from "../evaluation/dnd-dsl-predefined-signatures.js";
import type { SlotContext } from "./slot-context.js";

/** The name slot of `call predefined <name>` */
const PREDEFINED_SLOT = /\bcall[ \t]+predefined[ \t]+(\w*)$/;

export function predefinedCompletions({ line, params, matches }: SlotContext): CompletionItem[] {
    const match = PREDEFINED_SLOT.exec(line);
    if (!match) return [];

    const partial = match[1];
    const range = { start: { line: params.position.line, character: params.position.character - partial.length }, end: params.position };
    return PREDEFINED_SIGNATURES
        .filter(sig => !partial || matches(partial, sig.name))
        .map(sig => ({
            label: sig.name,
            kind: CompletionItemKind.Function,
            detail: `${sig.name}(${sig.params.join(", ")})`,
            documentation: sig.description,
            sortText: "0",
            textEdit: { range, newText: sig.name },
        }));
}
