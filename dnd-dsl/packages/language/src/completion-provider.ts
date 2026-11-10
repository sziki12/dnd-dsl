import { AstUtils, CstUtils } from "langium";
import type { AstNode, AstNodeDescription, AstNodeLocator, IndexManager, LangiumDocument, LangiumDocuments, Reference, ReferenceInfo } from "langium";
import { DefaultCompletionProvider, type CompletionContext } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import { CompletionItemKind, CompletionList } from "vscode-languageserver";
import type { CancellationToken, CompletionItem, CompletionParams } from "vscode-languageserver";
import { isChangeOccurrence, isFaction, isLocation, isNpc, isQuest, isRefChain, isSetStatement, isVariableRef, isWorld, type Location, type RefChain, type RelationType } from "./generated/ast.js";
import { PREDEFINED_SIGNATURES } from "./evaluation/dnd-dsl-predefined-signatures.js";
import { COLLECTION_FIELDS, SIMPLE_FIELDS, ObjectKind, collectionHeadKind } from "./dnd-dsl-validator.js";
import { chainHead } from "./evaluation/dnd-dsl-state-path.js";
import { HOST_KIND } from "./evaluation/dnd-dsl-relations.js";

/** The name slot of `call predefined <name>` */
const CALL_KEYWORD = "call";
const PREDEFINED_KEYWORD = "predefined";
const PREDEFINED_SLOT = new RegExp(`\\b${CALL_KEYWORD}[ \\t]+${PREDEFINED_KEYWORD}[ \\t]+(\\w*)$`);
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
/**
 * The DSL keywords that introduce a `[Type:STRING]` entity reference, mapped to the
 * cross-reference target type. `event triggered "X"` and `event "X"` both land on Event.
 */
const TRIGGERED_KEYWORD = "triggered";
const ENTITY_SLOT = new RegExp(
    `(?:^|[^\\w"])(${Object.keys(ENTITY_TYPE).join("|")})[ \\t]+(?:${TRIGGERED_KEYWORD}[ \\t]+)?("?)([^"\\n]*)$`,
);

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

export class DndCompletionProvider extends DefaultCompletionProvider {
    //We would like completion for:
    // - member access via '.' 
    // - and for entity names via '"'
    override readonly completionOptions = { triggerCharacters: ['"', "."] };

    private readonly indexManager: IndexManager;
    private readonly documents: LangiumDocuments;
    private readonly locator: AstNodeLocator;

    constructor(services: LangiumServices) {
        super(services);
        this.indexManager = services.shared.workspace.IndexManager;
        this.documents = services.shared.workspace.LangiumDocuments;
        this.locator = services.workspace.AstNodeLocator;
    }

    override async getCompletion(
        document: LangiumDocument,
        params: CompletionParams,
        cancelToken?: CancellationToken,
    ): Promise<CompletionList | undefined> {
        const members = this.memberCompletions(document, params);
        // After `entity .` / `var .` the member list should be only shown
        if (members.length > 0) {
            return CompletionList.create(this.deduplicateItems(members), true);
        }

        const children = this.childNameCompletions(document, params);
        if (children) {
            return CompletionList.create(this.deduplicateItems(children), true);
        }

        const relationTypes = this.relationTypeCompletions(document, params);
        if (relationTypes) {
            return CompletionList.create(this.deduplicateItems(relationTypes), true);
        }

        const names = this.entityNameCompletions(document, params).concat(this.doKeyword(document, params));
        if (names.length > 0) {
            return CompletionList.create(this.deduplicateItems(names), true);
        }

        const predefined = this.predefinedCompletions(document, params);
        if (predefined.length > 0) {
            return CompletionList.create(predefined, true);
        }

        return this.quoteRelationTypes(document, params, await super.getCompletion(document, params, cancelToken));
    }

    /**
     * With no quote typed yet (an empty line or a bare `Mem`) the default cross-reference completion offers the relation
     * type as a bare name. Rewrites those items to the quoted string and drops the types the entity cannot start from.
     */
    private quoteRelationTypes(document: LangiumDocument, params: CompletionParams, list: CompletionList | undefined): CompletionList | undefined {
        if (!list) return list;
        const types = new Map<string, RelationType | undefined>();
        for (const description of this.indexManager.allElements("RelationType")) {
            types.set(description.name, this.nodeOf(description) as RelationType | undefined);
        }
        if (types.size === 0) return list;

        const hostKind = this.hostKindAt(document, params);
        const items: CompletionItem[] = [];
        for (const item of list.items) {
            const type = item.kind === CompletionItemKind.Reference ? types.get(item.label) : undefined;
            const edit = item.textEdit;
            if (!type || !edit || !("range" in edit)) {
                items.push(item);
                continue;
            }
            if (hostKind && !(type.sources as string[]).includes(hostKind)) continue;
            items.push({ ...item, textEdit: { range: edit.range, newText: `"${item.label}"` } });
        }
        return CompletionList.create(items, list.isIncomplete);
    }

    /** The relation kind of the npc or faction the cursor is in, if any. */
    private hostKindAt(document: LangiumDocument, params: CompletionParams): string | undefined {
        const cst = document.parseResult.value.$cstNode;
        const leaf = cst && CstUtils.findLeafNodeBeforeOffset(cst, document.textDocument.offsetAt(params.position));
        const host = leaf && AstUtils.getContainerOfType(leaf.astNode, node => isNpc(node) || isFaction(node));
        return host ? HOST_KIND[host.$type] : undefined;
    }

    private predefinedCompletions(document: LangiumDocument, params: CompletionParams): CompletionItem[] {
        const td = document.textDocument;
        const line = td.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
        const match = PREDEFINED_SLOT.exec(line);
        if (!match) return [];

        const partial = match[1];
        const range = { start: { line: params.position.line, character: params.position.character - partial.length }, end: params.position };
        const items: CompletionItem[] = [];
        for (const sig of PREDEFINED_SIGNATURES) {
            if (partial && !this.fuzzyMatcher.match(partial, sig.name)) continue;
            items.push({
                label: sig.name,
                kind: CompletionItemKind.Function,
                detail: `${sig.name}(${sig.params.join(', ')})`,
                documentation: sig.description,
                sortText: "0",
                textEdit: { range, newText: sig.name },
            });
        }
        return items;
    }

    private memberCompletions(document: LangiumDocument, params: CompletionParams): CompletionItem[] {
        const cst = document.parseResult.value.$cstNode;
        if (!cst) return [];

        const offset = document.textDocument.offsetAt(params.position);
        const leaf = CstUtils.findLeafNodeBeforeOffset(cst, offset);
        if (!leaf) return [];

        let chain: RefChain | undefined;
        let restIndex: number | undefined;
        let replaceFrom = offset;
        let partial = "";

        if (leaf.text === "." && isRefChain(leaf.astNode)) {
            // `Object . <cursor>` - the member segment does not exist in the AST yet
            chain = leaf.astNode;
            restIndex = chain.rest.length;
        } else {
            // `Object . Prop<cursor>` - a half-typed member is a real (unresolved) node
            const varRef = AstUtils.getContainerOfType(leaf.astNode, isVariableRef);
            const item = varRef?.$container;
            if (item?.$type === "VariableRefItem" && isRefChain(item.$container) && item.$containerProperty === "rest") {
                chain = item.$container;
                restIndex = item.$containerIndex ?? 0;
                replaceFrom = leaf.offset;
                partial = leaf.text;
            }
        }

        if (!chain || restIndex === undefined) return [];

        const refInfo = this.syntheticMemberRef(chain, restIndex);
        const scope = this.scopeProvider.getScope(refInfo);

        const context: CompletionContext = {
            document,
            textDocument: document.textDocument,
            features: [],
            tokenOffset: replaceFrom,
            tokenEndOffset: offset,
            offset,
            position: params.position,
            node: chain,
        };

        const items: CompletionItem[] = [];
        for (const description of scope.getAllElements()) {
            const value = this.createReferenceCompletionItem(description, refInfo, context);
            const item = this.fillCompletionItem(context, { ...value, kind: CompletionItemKind.Field });
            if (item) items.push(item);
        }

        // `field` (locations/npcs/.../name/description) is only legal directly off the
        // head, and never as a `set`/`on change` target - mirrors
        // DndDslValidator.checkRefChainField exactly, so nothing offered here is ever
        // rejected once picked.
        const isWriteOrWatchTarget = (isSetStatement(chain.$container) && chain.$container.target === chain)
            || (isChangeOccurrence(chain.$container) && chain.$container.target === chain);
        if (restIndex === 0 && !isWriteOrWatchTarget) {
            const kind = collectionHeadKind(chainHead(chain));
            if (kind) {
                const range = { start: document.textDocument.positionAt(replaceFrom), end: params.position };
                for (const field of COLLECTION_FIELDS[kind].concat(SIMPLE_FIELDS[kind])) {
                    if (partial && !this.fuzzyMatcher.match(partial, field)) continue;
                    items.push({
                        label: field,
                        kind: CompletionItemKind.Field,
                        detail: `${kind} . ${field}`,
                        sortText: "0",
                        textEdit: { range, newText: field },
                    });
                }
            }
        }
        return items;
    }

    /**
     * The `ReferenceInfo` shape `DndScopeProvider.getScope` matches for member access:
     * a `VariableRef` sitting in `RefChain.rest[restIndex]`.
     */
    private syntheticMemberRef(chain: RefChain, restIndex: number): ReferenceInfo {
        const item = {
            $type: "VariableRefItem",
            $container: chain,
            $containerProperty: "rest",
            $containerIndex: restIndex,
        } as unknown as AstNode;
        const container = {
            $type: "VariableRef",
            $container: item,
            $containerProperty: "val",
        } as unknown as AstNode;
        return {
            container,
            property: "val",
            reference: { $refText: "", ref: undefined } as unknown as Reference,
        };
    }

    private entityNameCompletions(document: LangiumDocument, params: CompletionParams): CompletionItem[] {
        const td = document.textDocument;
        const line = td.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
        const match = ENTITY_SLOT.exec(line);
        if (!match) return [];

        const [, keyword, quote, partial] = match;
        const typeName = ENTITY_TYPE[keyword];
        if (!typeName) return [];

        return this.nameItems(document, params, partial, quote === '"', typeName, this.nameEntries(typeName));
    }

    /**
     * The names of every entity of a kind. Objectives of different quests and locations under different parents may
     * share a name; the quest or parent in the detail keeps those entries apart. Counted by owner, not by index
     * entry: the same world open twice is not a shared name.
     */
    private nameEntries(typeName: string): Array<string | { name: string; detail: string }> {
        const found = Array.from(this.indexManager.allElements(typeName), description => ({ description, owner: this.ownerOf(typeName, this.nodeOf(description)) }));
        const owners = new Map<string, Set<string>>();
        for (const { description, owner } of found) {
            const keys = owners.get(description.name) ?? new Set<string>();
            keys.add(owner.key);
            owners.set(description.name, keys);
        }
        return found.map(({ description, owner }) =>
            owners.get(description.name)!.size > 1 && owner.detail ? { name: description.name, detail: owner.detail } : description.name);
    }

    /** What tells apart two entities of a name: the quest of an objective, the parent locations of a location. */
    private ownerOf(typeName: string, node: AstNode | undefined): { key: string; detail?: string } {
        if (typeName === ObjectKind.Objective && node?.$container && "name" in node.$container) {
            const quest = String(node.$container.name);
            return { key: quest, detail: `${typeName} of ${quest}` };
        }
        if (typeName === ObjectKind.Location && node) {
            const parents: string[] = [];
            for (let parent: AstNode | undefined = node.$container; isLocation(parent); parent = parent.$container) parents.unshift(parent.name);
            return { key: JSON.stringify(parents), detail: parents.length > 0 ? `${typeName} in ${parents.join(" -> ")}` : undefined };
        }
        return { key: "" };
    }

    /**
     * Only the children a step or `entry` may name: after `location "A" ->` / `. sublocations` the sublocations of A,
     * after `quest "Q" ->` / `. objectives` the objectives of Q, and for `entry` the sublocations of the location it
     * sits in. Undefined when the cursor is in no such slot, so the general name completion still runs. The base is
     * found by name, not from the half-typed AST, which does not hold a step that has no closing quote yet.
     */
    private childNameCompletions(document: LangiumDocument, params: CompletionParams): CompletionItem[] | undefined {
        const td = document.textDocument;
        const line = td.getText({ start: { line: params.position.line, character: 0 }, end: params.position });

        const slot = STEP_SLOT.exec(line);
        if (slot) {
            const [, keyword, headName, earlier, collection, quote, partial] = slot;
            if (collection && (collection === "sublocations") !== (keyword === "location")) return [];

            let current = this.findByName(keyword === "location" ? ObjectKind.Location : ObjectKind.Quest, headName);
            for (const [, name] of earlier.matchAll(/"([^"\n]*)"/g)) {
                current = isLocation(current) ? current.sublocations.find(l => l.name === name) : undefined;
            }
            const children = isLocation(current) ? current.sublocations : isQuest(current) ? current.objectives : [];
            const detail = isLocation(current) ? ObjectKind.Location : ObjectKind.Objective;
            return this.nameItems(document, params, partial, quote === '"', detail, children.map(c => c.name));
        }

        const entry = ENTRY_SLOT.exec(line);
        if (entry) {
            const owner = this.locationAtCursor(document, params);
            return this.nameItems(document, params, entry[2], entry[1] === '"', ObjectKind.Location, owner ? owner.sublocations.map(l => l.name) : []);
        }

        const exit = EXIT_SLOT.exec(line);
        if (exit) {
            const [, earlier, quote, partial] = exit;
            const path = Array.from(earlier.matchAll(/"([^"\n]*)"/g), match => match[1]);
            if (path.length === 0) {
                return this.nameItems(document, params, partial, quote === '"', ObjectKind.Location, this.nameEntries(ObjectKind.Location));
            }
            let current = this.nearestLocation(path[0], this.locationAtCursor(document, params));
            for (const name of path.slice(1)) current = current?.sublocations.find(l => l.name === name);
            return this.nameItems(document, params, partial, quote === '"', ObjectKind.Location, current ? current.sublocations.map(l => l.name) : []);
        }
        return undefined;
    }

    /** The location the cursor is inside, found from the syntax tree before it (the half-typed line is not in the AST itself). */
    private locationAtCursor(document: LangiumDocument, params: CompletionParams): Location | undefined {
        const cst = document.parseResult.value.$cstNode;
        const leaf = cst && CstUtils.findLeafNodeBeforeOffset(cst, document.textDocument.offsetAt(params.position));
        return leaf && AstUtils.getContainerOfType(leaf.astNode, isLocation);
    }

    /**
     * The first name of an exit target as the linker would find it: among the sublocations of the location the exit is in,
     * then among its siblings, then the siblings of its parent and so on up; else any location of that name.
     */
    private nearestLocation(name: string, owner: Location | undefined): Location | undefined {
        const levels: Location[][] = owner ? [owner.sublocations] : [];
        for (let place: AstNode | undefined = owner; place; place = place.$container) {
            if (!isLocation(place)) continue;
            const parent = place.$container;
            levels.push(isLocation(parent) ? parent.sublocations : isWorld(parent) ? parent.locations : []);
        }
        for (const level of levels) {
            const hit = level.find(location => location.name === name);
            if (hit) return hit;
        }
        return this.findByName(ObjectKind.Location, name) as Location | undefined;
    }

    /**
     * The relation types that can start from the entity the cursor is in (a fact), or from the subject kind a query names.
     * Undefined when the cursor is in neither slot, so the other completions still run. Langium's own cross-reference
     * completion would offer the bare name, since it does not know the string needs its quotes.
     */
    private relationTypeCompletions(document: LangiumDocument, params: CompletionParams): CompletionItem[] | undefined {
        const td = document.textDocument;
        const line = td.getText({ start: { line: params.position.line, character: 0 }, end: params.position });

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
            if (!hasOpenQuote && this.isOpenSubjectPredicate(query[2])) return this.endKindItems(document, params, partial);
            hostKind = query[1];
        } else if (open) {
            hostKind = open[1];
            partial = open[2] ?? "";
            hasOpenQuote = open[2] !== undefined;
        } else if (fact) {
            partial = fact[1];
            hasOpenQuote = true;
            hostKind = this.hostKindAt(document, params);
            // A line that starts with a quote outside an npc or faction is not a fact.
            if (!hostKind) return undefined;
        } else {
            return undefined;
        }

        const names: string[] = [];
        for (const description of this.indexManager.allElements("RelationType")) {
            const type = this.nodeOf(description) as RelationType | undefined;
            if (type && hostKind && !(type.sources as string[]).includes(hostKind)) continue;
            names.push(description.name);
        }
        const types = this.nameItems(document, params, partial, hasOpenQuote, "RelationType", names);
        return open ? [...types, ...this.entityNameCompletions(document, params)] : types;
    }

    /** `do` after a complete `for ... in relation ...` header. Langium's completion is skipped when names are offered, so it is added here. */
    private doKeyword(document: LangiumDocument, params: CompletionParams): CompletionItem[] {
        const td = document.textDocument;
        const line = td.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
        const match = FOR_QUERY_END.exec(line);
        if (!match || (match[1] && !this.fuzzyMatcher.match(match[1], "do"))) return [];
        const range = { start: td.positionAt(td.offsetAt(params.position) - match[1].length), end: params.position };
        return [{ label: "do", kind: CompletionItemKind.Keyword, sortText: "1", textEdit: { range, newText: "do" } }];
    }

    /**
     * The kind keywords a query's target may start with. Langium's own completion cannot offer them here: it reads
     * `npc "Member of"` as a named subject and expects a relation type next.
     */
    private endKindItems(document: LangiumDocument, params: CompletionParams, partial: string): CompletionItem[] {
        const td = document.textDocument;
        const range = { start: td.positionAt(td.offsetAt(params.position) - partial.length), end: params.position };
        return RELATION_END_KINDS
            .filter(kind => !partial || this.fuzzyMatcher.match(partial, kind))
            .map(kind => ({ label: kind, kind: CompletionItemKind.Keyword, sortText: "0", textEdit: { range, newText: kind } }));
    }

    /**
     * A string after `relation npc` is the subject's name or, for an open subject, the relation type. It is the type when
     * a relation type has that name. shortcut: an entity named like a relation type is read as the type; the half-typed
     * line itself parses into a bogus entity of that name, so the entity names cannot settle it.
     */
    private isOpenSubjectPredicate(text: string): boolean {
        return Array.from(this.indexManager.allElements("RelationType")).some(d => d.name === text);
    }

    private findByName(type: ObjectKind, name: string): AstNode | undefined {
        let first: AstNode | undefined;
        for (const description of this.indexManager.allElements(type)) {
            if (description.name !== name) continue;
            const node = this.nodeOf(description);
            // A top-level location is where a path starts; a sublocation of the same name is reached through its parent.
            if (!isLocation(node) || !isLocation(node.$container)) return node;
            first ??= node;
        }
        return first;
    }

    private nodeOf(description: AstNodeDescription): AstNode | undefined {
        if (description.node) return description.node;
        const target = this.documents.hasDocument(description.documentUri) ? this.documents.getDocument(description.documentUri) : undefined;
        return target ? this.locator.getAstNode(target.parseResult.value, description.path) : undefined;
    }

    private nameItems(document: LangiumDocument, params: CompletionParams, partial: string, hasOpenQuote: boolean, detail: string, names: Array<string | { name: string; detail: string }>): CompletionItem[] {
        const td = document.textDocument;
        const offset = td.offsetAt(params.position);
        const text = td.getText();
        // The replaced range must start at the partial, not at the opening quote -
        // Monaco derives the filter prefix from range-start..cursor, and a leading `"`
        // there matches no entity name and silently drops every candidate.
        const start = td.positionAt(offset - partial.length);
        const end = td.positionAt(hasOpenQuote && text[offset] === '"' ? offset + 1 : offset);
        const newTextPrefix = hasOpenQuote ? "" : '"';

        const items: CompletionItem[] = [];
        for (const entry of names) {
            const name = typeof entry === "string" ? entry : entry.name;
            if (partial && !this.fuzzyMatcher.match(partial, name)) continue;
            items.push({
                label: name,
                kind: CompletionItemKind.Value,
                detail: typeof entry === "string" ? detail : entry.detail,
                sortText: "0",
                textEdit: {
                    range: { start, end },
                    newText: `${newTextPrefix}${name}"`,
                },
            });
        }
        return items;
    }

}
