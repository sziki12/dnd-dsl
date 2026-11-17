import type { IndexManager, LangiumDocument } from "langium";
import type { CompletionItem, CompletionParams } from "vscode-languageserver";
import type { NameEntry } from "./quoted-names.js";
import type { WorldNames } from "./world-names.js";

/** What a slot needs to answer: where the cursor is, the text before it, and the lookups every slot shares. */
export interface SlotContext {
    readonly document: LangiumDocument;
    readonly params: CompletionParams;
    /** The cursor's line up to the cursor. */
    readonly line: string;
    readonly names: WorldNames;
    readonly indexManager: IndexManager;
    matches(partial: string, name: string): boolean;
    /** The names that match the partial, each with the quotes the cursor still lacks. */
    nameItems(partial: string, hasOpenQuote: boolean, detail: string, names: NameEntry[]): CompletionItem[];
}
