import { AstUtils, CstUtils } from "langium";
import type { CompletionItem } from "vscode-languageserver";
import { isLocation, isQuest, type Location } from "../generated/ast.js";
import { ObjectKind } from "../dnd-dsl-validator.js";
import type { SlotContext } from "./slot-context.js";

/**
 * `location "A" -> "B" -> "` / `quest "Q" . objectives "`: the head, the names of the steps already taken, whether the
 * next one has its quote yet, and what is typed of it. The keyword after the dot, when there is one, says which
 * collection the step names.
 */
const STEP_SLOT = /\b(location|quest)[ \t]+"([^"\n]*)"((?:[ \t]*(?:->|\.[ \t]*(?:sublocations|objectives))[ \t]*"[^"\n]*")*)[ \t]*(?:->|\.[ \t]*(sublocations|objectives))[ \t]*("?)([^"\n]*)$/;
const ENTRY_SLOT = /(?:^|[^\w"])entry[ \t]+("?)([^"\n]*)$/;
/** `exit "Back" to "A" -> "`: the names of the path already written, whether the next one has its quote yet, and what is typed of it. */
const EXIT_SLOT = /\bexit[ \t]+"[^"\n]*"[ \t]+to[ \t]+((?:"[^"\n]*"[ \t]*->[ \t]*)*)("?)([^"\n]*)$/;

/**
 * Only the children a step, `entry` or exit target may name. Undefined when the cursor is in no such slot, so the general
 * name completion still runs. The base is found by name, not from the half-typed AST, which does not hold a step that has
 * no closing quote yet.
 */
export function childNameCompletions(ctx: SlotContext): CompletionItem[] | undefined {
    return stepNames(ctx) ?? entryNames(ctx) ?? exitNames(ctx);
}

/** After `location "A" ->` / `. sublocations` the sublocations of A, after `quest "Q" ->` / `. objectives` the objectives of Q. */
function stepNames({ line, document, names, nameItems }: SlotContext): CompletionItem[] | undefined {
    const slot = STEP_SLOT.exec(line);
    if (!slot) return undefined;
    const [, keyword, headName, earlier, collection, quote, partial] = slot;
    if (collection && (collection === "sublocations") !== (keyword === "location")) return [];

    let current = names.findByName(keyword === "location" ? ObjectKind.Location : ObjectKind.Quest, headName, document);
    for (const [, name] of earlier.matchAll(/"([^"\n]*)"/g)) {
        current = isLocation(current) ? current.sublocations.find(l => l.name === name) : undefined;
    }
    const children = isLocation(current) ? current.sublocations : isQuest(current) ? current.objectives : [];
    const detail = isLocation(current) ? ObjectKind.Location : ObjectKind.Objective;
    return nameItems(partial, quote === '"', detail, children.map(c => c.name));
}

/** `entry` names a sublocation of the location it sits in. */
function entryNames(ctx: SlotContext): CompletionItem[] | undefined {
    const entry = ENTRY_SLOT.exec(ctx.line);
    if (!entry) return undefined;
    const owner = locationAtCursor(ctx);
    return ctx.nameItems(entry[2], entry[1] === '"', ObjectKind.Location, owner ? owner.sublocations.map(l => l.name) : []);
}

/** An exit target is a path: the first name is found as the linker would, the rest are children of the one before. */
function exitNames(ctx: SlotContext): CompletionItem[] | undefined {
    const exit = EXIT_SLOT.exec(ctx.line);
    if (!exit) return undefined;
    const [, earlier, quote, partial] = exit;
    const path = Array.from(earlier.matchAll(/"([^"\n]*)"/g), match => match[1]);
    if (path.length === 0) {
        return ctx.nameItems(partial, quote === '"', ObjectKind.Location, ctx.names.nameEntries(ObjectKind.Location, ctx.document));
    }
    let current = ctx.names.nearestLocation(path[0], locationAtCursor(ctx), ctx.document);
    for (const name of path.slice(1)) current = current?.sublocations.find(l => l.name === name);
    return ctx.nameItems(partial, quote === '"', ObjectKind.Location, current ? current.sublocations.map(l => l.name) : []);
}

/** The location the cursor is inside, found from the syntax tree before it (the half-typed line is not in the AST itself). */
function locationAtCursor({ document, params }: SlotContext): Location | undefined {
    const cst = document.parseResult.value.$cstNode;
    const leaf = cst && CstUtils.findLeafNodeBeforeOffset(cst, document.textDocument.offsetAt(params.position));
    return leaf && AstUtils.getContainerOfType(leaf.astNode, isLocation);
}
