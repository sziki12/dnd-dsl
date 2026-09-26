import { CstUtils } from "langium";
import type { LangiumDocument } from "langium";
import { MultilineCommentHoverProvider } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import type { Hover, HoverParams } from "vscode-languageserver";
import { isFunctionCall } from "./generated/ast.js";
import { getPredefinedSignature } from "./evaluation/dnd-dsl-predefined-signatures.js";

export class DndHoverProvider extends MultilineCommentHoverProvider {
    constructor(services: LangiumServices) {
        super(services);
    }

    override async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const predefined = this.predefinedFunctionHover(document, params);
        if (predefined) return predefined;
        return super.getHoverContent(document, params);
    }
    /**
     * Adds hover for `call predefined <name>`
     **/
    private predefinedFunctionHover(document: LangiumDocument, params: HoverParams): Hover | undefined {
        const cst = document.parseResult.value.$cstNode;
        if (!cst) return undefined;

        const offset = document.textDocument.offsetAt(params.position);
        const leaf = CstUtils.findLeafNodeAtOffset(cst, offset);
        if (!leaf) return undefined;

        const call = leaf.astNode;
        if (!isFunctionCall(call) || !call.predefined || !call.predefinedTarget) return undefined;
        // `call`/`predefined`/`with` all belong to the same FunctionCall node too
        // only the leaf whose text is the target name itself is the one we want to hover
        if (leaf.text !== call.predefinedTarget) return undefined;

        const sig = getPredefinedSignature(call.predefinedTarget);
        if (!sig) return undefined;

        return {
            contents: {
                kind: "markdown",
                value: `\`${sig.name}(${sig.params.join(", ")})\`\n\n${sig.description}`,
            },
        };
    }
}
