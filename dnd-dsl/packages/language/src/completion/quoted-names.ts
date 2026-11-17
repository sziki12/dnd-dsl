import type { LangiumDocument } from "langium";
import { CompletionItemKind } from "vscode-languageserver";
import type { CompletionItem, CompletionParams, TextEdit } from "vscode-languageserver";

type TextDoc = LangiumDocument["textDocument"];

/** A name to offer, and what tells it apart from the others (its kind, or its owner when the name is shared). */
export type NameEntry = string | { name: string; detail: string };

/** The text of the cursor's line up to the cursor. */
export function lineBefore(document: LangiumDocument, params: CompletionParams): string {
    return document.textDocument.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
}

/**
 * The edit that writes a quoted name over what is typed. It starts at the partial, not at the opening quote: Monaco
 * filters by the text from the range start to the cursor, and a `"` there matches no name and drops every candidate.
 * With the opening quote typed only the name and the closing quote are added, and a closing quote already after the
 * cursor is consumed.
 */
export function quotedEdit(td: TextDoc, offset: number, partial: string, hasOpenQuote: boolean, name: string): TextEdit {
    const start = td.positionAt(offset - partial.length);
    const end = td.positionAt(hasOpenQuote && td.getText().charAt(offset) === '"' ? offset + 1 : offset);
    return { range: { start, end }, newText: hasOpenQuote ? `${name}"` : `"${name}"` };
}

/** One item per name that matches the partial; a name without its own detail gets `detail`. */
export function nameItems(
    td: TextDoc,
    offset: number,
    partial: string,
    hasOpenQuote: boolean,
    detail: string,
    names: NameEntry[],
    matches: (partial: string, name: string) => boolean,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const entry of names) {
        const name = typeof entry === "string" ? entry : entry.name;
        if (partial && !matches(partial, name)) continue;
        items.push({
            label: name,
            kind: CompletionItemKind.Value,
            detail: typeof entry === "string" ? detail : entry.detail,
            sortText: "0",
            textEdit: quotedEdit(td, offset, partial, hasOpenQuote, name),
        });
    }
    return items;
}
