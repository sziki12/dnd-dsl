import { AstUtils, CstUtils } from "langium";
import type { AstNode, LangiumDocument, Reference, ReferenceInfo } from "langium";
import { DefaultCompletionProvider, type CompletionContext } from "langium/lsp";
import { CompletionItemKind, CompletionList } from "vscode-languageserver";
import type { CancellationToken, CompletionItem, CompletionParams } from "vscode-languageserver";
import { isRefChain, isVariableRef, type RefChain } from "./generated/ast.js";

/**
 * Adds `.`-member completion to a RefChain (`location "X" . <member>`,
 * `npc "Y" . <member>`, `Resources . <member>`).
 *
 * Langium's completion parser does not surface the `rest+=VariableRefItem` cross
 * reference from a synthetic node when a chain segment is still being typed, so the
 * built-in cross-reference completion offers nothing after a `.`. This provider
 * detects that position from the CST, builds the same synthetic `VariableRef` the
 * scope provider expects, and lets `DndScopeProvider.getScope` produce the member
 * candidates (an entity's `.variables`, an `object` value's fields).
 *
 * Completion still only fires on explicit request (Ctrl+Space) - `.` is not
 * registered as a trigger character.
 */
export class DndCompletionProvider extends DefaultCompletionProvider {
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
}
