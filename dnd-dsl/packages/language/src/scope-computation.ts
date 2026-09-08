import { AstUtils, DefaultScopeComputation, type AstNode, type AstNodeDescription, type LangiumDocument } from "langium";
import type { CancellationToken } from "vscode-languageserver";
import { isVariableDeclaration } from "./generated/ast.js";

/**
 * Exports the whole named tree to the global index, not just the direct children of
 * the `Model` root (Langium's default). This is what lets a separately-parsed script
 * document (`reference world "X" ...`) link `location "X"` / `quest "Y"` / `call fn`
 * / `trigger "E"` against an already-parsed world document in the same workspace.
 *
 * `VariableDeclaration` is deliberately excluded - a variable is reachable only
 * through a RefChain member step (`entity . var`, resolved off the entity node's
 * own `.variables`), never as a bare global name, so `.`-member access stays strict.
 */
export class DndScopeComputation extends DefaultScopeComputation {
    override collectExportedSymbols(document: LangiumDocument, cancelToken?: CancellationToken): Promise<AstNodeDescription[]> {
        return this.collectExportedSymbolsForNode(
            document.parseResult.value,
            document,
            (node: AstNode) => AstUtils.streamAllContents(node).filter(n => !isVariableDeclaration(n)),
            cancelToken,
        );
    }
}
