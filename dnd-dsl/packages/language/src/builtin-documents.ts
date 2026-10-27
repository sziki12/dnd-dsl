import { URI, type LangiumDocument } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { OBJECTIVE_STATUSES, QUEST_STATUSES } from './evaluation/dnd-dsl-status.js';

/**
 * Enums that exist in every world without the DM ever declaring them. Injected into
 * every workspace build alongside the DM's own document(s), then resolved through the
 * ordinary global-Enum fallback in DndScopeProvider.resolveEnum - no special-casing
 * needed anywhere else: EnumValueRef linking, `Status::` completion, the enum-mismatch
 * validator and list-of-enum support all just see another Enum node in the index, same
 * as if the DM had typed it themselves.
 *
 * Two separate enums, not one shared "Status" - Quest and Objective are different state
 * machines (see QUEST_STATUS_IMPLEMENTATION.md) and mixing their values into one enum
 * would let a Quest compare against Incomplete/Completed, which is meaningless for it.
 */
export const BUILTIN_WORLD_NAME = '__builtin__';

export const BUILTIN_SOURCE = [
    `world "${BUILTIN_WORLD_NAME}"`,
    `enum QuestStatus { ${QUEST_STATUSES.join(', ')} }`,
    `enum ObjectiveStatus { ${OBJECTIVE_STATUSES.join(', ')} }`,
    // Relation types live here too, so a fact like `"Member of" faction "Guards"` links in every world.
    'relation "Member of" from npc to faction',
].join('\n');

export const BUILTIN_URI = 'memory://builtin/status.dnd';

/**
 * Adds the builtin document to `shared`'s workspace and links it (validation off - it's
 * fixed, trusted source, never worth re-checking). Call once per services
 * instance/build, alongside the caller's own document(s) in the same `build(...)` call
 * where practical, so QuestStatus/ObjectiveStatus resolve for them immediately. Safe to
 * call more than once on the same `shared` (e.g. a long-lived LSP connection) - returns
 * the existing document instead of re-adding it.
 */
export async function registerBuiltinDocument(shared: LangiumSharedServices): Promise<LangiumDocument> {
    const documents = shared.workspace.LangiumDocuments;
    const uri = URI.parse(BUILTIN_URI);
    if (documents.hasDocument(uri)) {
        return documents.getDocument(uri)!;
    }
    const document = shared.workspace.LangiumDocumentFactory.fromString(BUILTIN_SOURCE, uri);
    documents.addDocument(document);
    await shared.workspace.DocumentBuilder.build([document], { validation: false });
    return document;
}
