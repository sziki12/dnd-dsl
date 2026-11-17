import { AstUtils, CstUtils } from "langium";
import type { AstNodeDescription, LangiumDocument } from "langium";
import { CompletionItemKind } from "vscode-languageserver";
import type { CompletionItem, Position } from "vscode-languageserver";
import { isFaction, isNpc, type RelationType } from "../generated/ast.js";
import { HOST_KIND } from "../evaluation/dnd-dsl-relations.js";
import { entityNameCompletions } from "./entity-slot.js";
import type { SlotContext } from "./slot-context.js";
import type { WorldNames } from "./world-names.js";

/** A line inside a relation query (`relation npc "Ann" "Member of" faction `, `for i in relation ...`): Langium offers the target no names there. */
const RELATION_QUERY_LINE = /\brelation\b/;
/**
 * The relation type of a fact (`"Member of" faction "Guards"`: the line starts with the string, no keyword before it)
 * and of a query head (`relation npc "Ann" "Member of" faction "Guards"`). The query's subject keyword says which kind
 * the type has to start from.
 */
const FACT_SLOT = /^[ \t]*"([^"\n]*)$/;
const QUERY_SLOT = /\brelation[ \t]+(npc|faction)[ \t]+"([^"\n]*)"[ \t]+(?:"([^"\n]*)|(\w*))$/;
const RELATION_END_KINDS = ["npc", "faction"];
/** `for i in relation npc "Ann" "Member of" faction ` / `... faction "Guards" d`: the query is complete, so `do` can follow. */
const FOR_QUERY_END = /\bfor[ \t]+\w+[ \t]+in[ \t]+relation\b.*"[^"\n]*"[ \t]+(?:npc|faction)(?:[ \t]+"[^"\n]*")?[ \t]+(\w*)$/;
// `relation npc "Mem` / `relation npc `: the string is a name, or the relation type of an open subject.
const OPEN_QUERY_SLOT = /\brelation[ \t]+(npc|faction)[ \t]+(?:"([^"\n]*))?$/;

/**
 * On a line of a relation query: the entity names and `do`. A relation query is read by Langium as a named subject, so it
 * never offers the target's names. Empty on any other line.
 */
export function relationQueryCompletions(ctx: SlotContext): CompletionItem[] {
    return RELATION_QUERY_LINE.test(ctx.line) ? entityNameCompletions(ctx).concat(doKeyword(ctx)) : [];
}

/**
 * The relation types that can start from the entity the cursor is in (a fact), or from the subject kind a query names.
 * Undefined when the cursor is in neither slot, so the other completions still run. Langium's own cross-reference
 * completion would offer the bare name, since it does not know the string needs its quotes.
 */
export function relationTypeCompletions(ctx: SlotContext): CompletionItem[] | undefined {
    const { line, indexManager, names, nameItems } = ctx;

    let hostKind: string | undefined;
    let partial: string;
    let hasOpenQuote: boolean;

    const query = QUERY_SLOT.exec(line);
    const open = query ? undefined : OPEN_QUERY_SLOT.exec(line);
    const fact = query || open ? undefined : FACT_SLOT.exec(line);
    if (query) {
        // `relation npc "Member of" `: the string already is the relation type of an open subject, so the target comes next.
        hasOpenQuote = query[3] !== undefined;
        partial = query[3] ?? query[4];
        if (!hasOpenQuote && isOpenSubjectPredicate(ctx, query[2])) return endKindItems(ctx, partial);
        hostKind = query[1];
    } else if (open) {
        hostKind = open[1];
        partial = open[2] ?? "";
        hasOpenQuote = open[2] !== undefined;
    } else if (fact) {
        partial = fact[1];
        hasOpenQuote = true;
        hostKind = hostKindAt(ctx.document, ctx.params.position);
        // A line that starts with a quote outside an npc or faction is not a fact.
        if (!hostKind) return undefined;
    } else {
        return undefined;
    }

    const typeNames: string[] = [];
    for (const description of indexManager.allElements("RelationType")) {
        const type = names.nodeOf(description) as RelationType | undefined;
        if (type && hostKind && !(type.sources as string[]).includes(hostKind)) continue;
        typeNames.push(description.name);
    }
    const types = nameItems(partial, hasOpenQuote, "RelationType", typeNames);
    return open ? [...types, ...entityNameCompletions(ctx)] : types;
}

/** A relation type starts a fact only in an entity of one of its source kinds; where the cursor is in no npc or faction, any type may be offered. */
export function relationTypeStartsHere(names: WorldNames, description: AstNodeDescription, document: LangiumDocument, position: Position): boolean {
    const hostKind = hostKindAt(document, position);
    const type = names.nodeOf(description) as RelationType | undefined;
    return !hostKind || !type || (type.sources as string[]).includes(hostKind);
}

/** The relation kind of the npc or faction the cursor is in, if any. */
function hostKindAt(document: LangiumDocument, position: Position): string | undefined {
    const cst = document.parseResult.value.$cstNode;
    const leaf = cst && CstUtils.findLeafNodeBeforeOffset(cst, document.textDocument.offsetAt(position));
    const host = leaf && AstUtils.getContainerOfType(leaf.astNode, node => isNpc(node) || isFaction(node));
    return host ? HOST_KIND[host.$type] : undefined;
}

/** `do` after a complete `for ... in relation ...` header. Langium's completion is skipped when names are offered, so it is added here. */
function doKeyword({ document, params, line, matches }: SlotContext): CompletionItem[] {
    const td = document.textDocument;
    const match = FOR_QUERY_END.exec(line);
    if (!match || (match[1] && !matches(match[1], "do"))) return [];
    const range = { start: td.positionAt(td.offsetAt(params.position) - match[1].length), end: params.position };
    return [{ label: "do", kind: CompletionItemKind.Keyword, sortText: "1", textEdit: { range, newText: "do" } }];
}

/**
 * The kind keywords a query's target may start with. Langium's own completion cannot offer them here: it reads
 * `npc "Member of"` as a named subject and expects a relation type next.
 */
function endKindItems({ document, params, matches }: SlotContext, partial: string): CompletionItem[] {
    const td = document.textDocument;
    const range = { start: td.positionAt(td.offsetAt(params.position) - partial.length), end: params.position };
    return RELATION_END_KINDS
        .filter(kind => !partial || matches(partial, kind))
        .map(kind => ({ label: kind, kind: CompletionItemKind.Keyword, sortText: "0", textEdit: { range, newText: kind } }));
}

/**
 * A string after `relation npc` is the subject's name or, for an open subject, the relation type. It is the type when
 * a relation type has that name. shortcut: an entity named like a relation type is read as the type; the half-typed
 * line itself parses into a bogus entity of that name, so the entity names cannot settle it.
 */
function isOpenSubjectPredicate({ indexManager }: SlotContext, text: string): boolean {
    return Array.from(indexManager.allElements("RelationType")).some(d => d.name === text);
}
