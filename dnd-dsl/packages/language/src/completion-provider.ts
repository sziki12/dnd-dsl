import { AstUtils, CstUtils, GrammarAST } from "langium";
import type { AstNode, IndexManager, LangiumDocument, MaybePromise, Reference, ReferenceInfo } from "langium";
import { DefaultCompletionProvider, type CompletionAcceptor, type CompletionContext, type CompletionValueItem, type NextFeature } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import { CompletionItemKind, CompletionList } from "vscode-languageserver";
import type { CancellationToken, CompletionItem, CompletionParams } from "vscode-languageserver";
import { isChangeOccurrence, isRefChain, isSetStatement, isVariableRef, type RefChain } from "./generated/ast.js";
import { predefinedCompletions } from "./completion/predefined-slot.js";
import { childNameCompletions } from "./completion/child-slots.js";
import { entityNameCompletions } from "./completion/entity-slot.js";
import { relationQueryCompletions, relationTypeCompletions, relationTypeStartsHere } from "./completion/relation-slots.js";
import type { SlotContext } from "./completion/slot-context.js";
import { COLLECTION_FIELDS, SIMPLE_FIELDS, collectionHeadKind } from "./dnd-dsl-validator.js";
import { chainHead } from "./evaluation/dnd-dsl-state-path.js";
import { lineBefore, nameItems, quotedEdit, type NameEntry } from "./completion/quoted-names.js";
import { WorldNames } from "./completion/world-names.js";

/** A cross-reference written as a string (`[Quest:STRING]`), so its names carry quotes. */
const isStringReference = (reference: GrammarAST.CrossReference): boolean =>
    GrammarAST.isRuleCall(reference.terminal) && reference.terminal.rule.ref?.name === "STRING";
/** The keywords without a letter that are worth offering; Langium drops every other one (see filterKeyword). */
const SYMBOL_KEYWORDS = new Set(["->"]);

export class DndCompletionProvider extends DefaultCompletionProvider {
    //We would like completion for:
    // - member access via '.' 
    // - and for entity names via '"'
    override readonly completionOptions = { triggerCharacters: ['"', "."] };

    private readonly indexManager: IndexManager;
    private readonly names: WorldNames;

    constructor(services: LangiumServices) {
        super(services);
        this.indexManager = services.shared.workspace.IndexManager;
        this.names = new WorldNames(this.indexManager, services.shared.workspace.LangiumDocuments, services.workspace.AstNodeLocator);
    }

    /** Langium drops every keyword without a letter; the arrow between a name and its child is worth offering. */
    protected override filterKeyword(context: CompletionContext, keyword: GrammarAST.Keyword): boolean {
        return SYMBOL_KEYWORDS.has(keyword.value) || super.filterKeyword(context, keyword);
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

        const ctx = this.slotContext(document, params);
        const children = childNameCompletions(ctx);
        if (children) {
            return CompletionList.create(this.deduplicateItems(children), true);
        }

        const relationTypes = relationTypeCompletions(ctx);
        if (relationTypes) {
            return CompletionList.create(this.deduplicateItems(relationTypes), true);
        }

        const queryNames = relationQueryCompletions(ctx);
        if (queryNames.length > 0) {
            return CompletionList.create(this.deduplicateItems(queryNames), true);
        }

        const predefined = predefinedCompletions(ctx);
        if (predefined.length > 0) {
            return CompletionList.create(predefined, true);
        }

        const base = await super.getCompletion(document, params, cancelToken);
        if (base && base.items.length > 0) return base;

        // After `quest ` in an expression Langium cannot tell a quest expression from a reference chain and finds no name to offer.
        const names = entityNameCompletions(ctx);
        return names.length > 0 ? CompletionList.create(this.deduplicateItems(names), true) : base;
    }

    /**
     * A reference written as a string is offered by Langium without its quotes, and inside a string with no closing quote the
     * lexer skips the quote and reads the words as names, so the parser sees `location Forest Of` and finds nothing to
     * complete. Ask where the string starts instead, and keep only the references written as a string: nothing else can be
     * completed inside one.
     */
    protected override findFeaturesAt(document: LangiumDocument["textDocument"], offset: number): NextFeature[] {
        const before = document.getText({ start: document.positionAt(0), end: document.positionAt(offset) });
        const line = before.slice(before.lastIndexOf("\n") + 1);
        // An odd number of quotes on the line: the last one opens a string that is still being typed.
        if ((line.match(/"/g) ?? []).length % 2 === 0) return super.findFeaturesAt(document, offset);
        return super.findFeaturesAt(document, before.length - line.length + line.lastIndexOf('"'))
            .filter(next => GrammarAST.isCrossReference(next.feature) && isStringReference(next.feature));
    }

    /** The names of a reference written as a string are offered with their quotes. */
    protected override completionForCrossReference(context: CompletionContext, next: NextFeature<GrammarAST.CrossReference>, acceptor: CompletionAcceptor): MaybePromise<void> {
        return super.completionForCrossReference(context, next, isStringReference(next.feature)
            ? (ctx, item) => { const edited = this.quotedItem(ctx, item); if (edited) acceptor(ctx, edited); }
            : acceptor);
    }

    private quotedItem(context: CompletionContext, item: CompletionValueItem): CompletionValueItem | undefined {
        if (!("nodeDescription" in item)) return item;
        const name = item.nodeDescription.name;
        const before = context.textDocument.getText().slice(0, context.offset);
        const open = /"([^"\n]*)$/.exec(before);
        const partial = open ? open[1] : /\w*$/.exec(before)![0];
        if (partial && !this.fuzzyMatcher.match(partial, name)) return undefined;
        if (item.nodeDescription.type === "RelationType" && !relationTypeStartsHere(this.names, item.nodeDescription, context.document, context.position)) return undefined;
        const detail = this.names.sharedDetail(item.nodeDescription, context.document) ?? item.detail;
        return { ...item, detail, textEdit: quotedEdit(context.textDocument, context.offset, partial, open !== null, name) };
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

    private slotContext(document: LangiumDocument, params: CompletionParams): SlotContext {
        return {
            document,
            params,
            line: lineBefore(document, params),
            names: this.names,
            indexManager: this.indexManager,
            matches: (partial, name) => this.fuzzyMatcher.match(partial, name),
            nameItems: (partial, hasOpenQuote, detail, entries) => this.nameItems(document, params, partial, hasOpenQuote, detail, entries),
        };
    }

    private nameItems(document: LangiumDocument, params: CompletionParams, partial: string, hasOpenQuote: boolean, detail: string, names: NameEntry[]): CompletionItem[] {
        return nameItems(document.textDocument, document.textDocument.offsetAt(params.position), partial, hasOpenQuote, detail, names, (p, n) => this.fuzzyMatcher.match(p, n));
    }

}
