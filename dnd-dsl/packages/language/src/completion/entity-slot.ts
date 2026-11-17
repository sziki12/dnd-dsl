import type { CompletionItem } from "vscode-languageserver";
import { ObjectKind } from "../dnd-dsl-validator.js";
import type { SlotContext } from "./slot-context.js";

const ENTITY_TYPE: Record<string, ObjectKind> = {
    location: ObjectKind.Location,
    npc: ObjectKind.Npc,
    faction: ObjectKind.Faction,
    party: ObjectKind.Party,
    quest: ObjectKind.Quest,
    objective: ObjectKind.Objective,
    event: ObjectKind.Event,
    trigger: ObjectKind.Event,
};
/** `event triggered "X"` and `event "X"` both name an Event. */
const TRIGGERED_KEYWORD = "triggered";
// An unquoted partial is one word, so `objective from quest ` is not read as the partial of `objective`.
const ENTITY_SLOT = new RegExp(
    `(?:^|[^\\w"])(${Object.keys(ENTITY_TYPE).join("|")})[ \\t]+(?:${TRIGGERED_KEYWORD}[ \\t]+)?(?:"([^"\\n]*)|(\\w*))$`,
);

/** The names of an entity kind after the keyword that introduces one (`location "`, `npc `, `trigger "`...). */
export function entityNameCompletions({ line, document, names, nameItems }: SlotContext): CompletionItem[] {
    const match = ENTITY_SLOT.exec(line);
    if (!match) return [];

    const [, keyword, quoted, bare] = match;
    const typeName = ENTITY_TYPE[keyword];
    if (!typeName) return [];

    return nameItems(quoted ?? bare, quoted !== undefined, typeName, names.nameEntries(typeName, document));
}
