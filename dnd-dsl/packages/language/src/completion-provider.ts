import { AstUtils, CstUtils } from "langium";
import type { AstNode, IndexManager, LangiumDocument, Reference, ReferenceInfo } from "langium";
import { DefaultCompletionProvider, type CompletionContext } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import { CompletionItemKind, CompletionList } from "vscode-languageserver";
import type { CancellationToken, CompletionItem, CompletionParams } from "vscode-languageserver";
import { isChangeOccurrence, isRefChain, isSetStatement, isVariableRef, type RefChain } from "./generated/ast.js";
import { PREDEFINED_SIGNATURES } from "./evaluation/dnd-dsl-predefined-signatures.js";
import { COLLECTION_FIELDS, SIMPLE_FIELDS, ObjectKind, collectionHeadKind } from "./dnd-dsl-validator.js";

/** The name slot of `call predefined <name>` */
const CALL_KEYWORD = "call";
const PREDEFINED_KEYWORD = "predefined";
const PREDEFINED_SLOT = new RegExp(`\\b${CALL_KEYWORD}[ \\t]+${PREDEFINED_KEYWORD}[ \\t]+(\\w*)$`);
const ENTITY_TYPE: Record<string, ObjectKind> = {
    location: ObjectKind.Location,
    npc: ObjectKind.Npc,
    quest: ObjectKind.Quest,
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

export class DndCompletionProvider extends DefaultCompletionProvider {
    //We would like completion for:
    // - member access via '.' 
    // - and for entity names via '"'
    override readonly completionOptions = { triggerCharacters: ['"', "."] };

    private readonly indexManager: IndexManager;

    constructor(services: LangiumServices) {
        super(services);
        this.indexManager = services.shared.workspace.IndexManager;
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

        const names = this.entityNameCompletions(document, params);
        if (names.length > 0) {
            return CompletionList.create(this.deduplicateItems(names), true);
        }

        const predefined = this.predefinedCompletions(document, params);
        if (predefined.length > 0) {
            return CompletionList.create(predefined, true);
        }

        return super.getCompletion(document, params, cancelToken);
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
            const kind = collectionHeadKind(chain.first);
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

        const hasOpenQuote = quote === '"';
        const offset = td.offsetAt(params.position);
        const text = td.getText();
        // The replaced range must start at the partial, not at the opening quote -
        // Monaco derives the filter prefix from range-start..cursor, and a leading `"`
        // there matches no entity name and silently drops every candidate.
        const start = td.positionAt(offset - partial.length);
        const end = td.positionAt(hasOpenQuote && text[offset] === '"' ? offset + 1 : offset);
        const newTextPrefix = hasOpenQuote ? "" : '"';

        const items: CompletionItem[] = [];
        for (const description of this.indexManager.allElements(typeName)) {
            if (partial && !this.fuzzyMatcher.match(partial, description.name)) continue;
            items.push({
                label: description.name,
                kind: CompletionItemKind.Value,
                detail: typeName,
                sortText: "0",
                textEdit: {
                    range: { start, end },
                    newText: `${newTextPrefix}${description.name}"`,
                },
            });
        }
        return items;
    }

}
