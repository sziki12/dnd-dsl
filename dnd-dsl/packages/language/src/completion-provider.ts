import { AstUtils, CstUtils } from "langium";
import type { AstNode, IndexManager, LangiumDocument, Reference, ReferenceInfo } from "langium";
import { DefaultCompletionProvider, type CompletionContext } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import { CompletionItemKind, CompletionList } from "vscode-languageserver";
import type { CancellationToken, CompletionItem, CompletionParams } from "vscode-languageserver";
import { isRefChain, isVariableRef, type RefChain } from "./generated/ast.js";

/**
 * The DSL keywords that introduce a `[Type:STRING]` entity reference, mapped to the
 * cross-reference target type. `event triggered "X"` and `event "X"` both land on Event.
 */
const ENTITY_SLOT = /(?:^|[^\w"])(location|npc|quest|trigger|event)[ \t]+(?:triggered[ \t]+)?("?)([^"\n]*)$/;
const ENTITY_TYPE: Record<string, string> = {
    location: "Location",
    npc: "Npc",
    quest: "Quest",
    event: "Event",
    trigger: "Event",
};

/**
 * Two completion refinements the built-in cross-reference completion misses in this
 * grammar:
 *
 * 1. `.`-member completion on a RefChain (`location "X" . <member>`,
 *    `npc "Y" . <member>`, `Resources . <member>`). Langium's completion parser does
 *    not surface the `rest+=VariableRefItem` cross reference from a synthetic node
 *    while a segment is being typed, so nothing is offered after a `.`.
 *
 * 2. Entity-name completion after `location` / `npc` / `quest` / `event` / `trigger`.
 *    The base `[Type:STRING]` completion works only for a single-word prefix and not
 *    for the `quest "` bare-quote case, because the keyword also starts a top-level
 *    declaration rule. A name like `"Forest Of The Damned"` stops completing the
 *    moment the space is typed.
 *
 * Trigger characters `.` and `"` make both lists open on the character that starts
 * the reference; general keyword/identifier completion still needs an explicit
 * request (no quick suggestions).
 */
export class DndCompletionProvider extends DefaultCompletionProvider {
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
        // After `entity .` / `var .` the member list is authoritative - the global
        // variable pool and keywords the base provider would offer there are noise.
        if (members.length > 0) {
            return CompletionList.create(this.deduplicateItems(members), true);
        }

        const names = this.entityNameCompletions(document, params);
        if (names.length > 0) {
            return CompletionList.create(this.deduplicateItems(names), true);
        }

        return super.getCompletion(document, params, cancelToken);
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

        if (leaf.text === "." && isRefChain(leaf.astNode)) {
            // `A . <cursor>` - the member segment does not exist in the AST yet.
            chain = leaf.astNode;
            restIndex = chain.rest.length;
        } else {
            // `A . Go<cursor>` - a half-typed member is a real (unresolved) node.
            const varRef = AstUtils.getContainerOfType(leaf.astNode, isVariableRef);
            const item = varRef?.$container;
            if (item?.$type === "VariableRefItem" && isRefChain(item.$container) && item.$containerProperty === "rest") {
                chain = item.$container;
                restIndex = item.$containerIndex ?? 0;
                replaceFrom = leaf.offset;
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
