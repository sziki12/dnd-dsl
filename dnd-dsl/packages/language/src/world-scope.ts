import { AstUtils, type AstNode, type AstNodeDescription, type LangiumDocuments } from "langium";
import { BUILTIN_WORLD_NAME } from "./builtin-documents.js";
import type { Model } from "./generated/ast.js";

// The editor holds the files of every world of an adventure in one language-server workspace, and Langium's global
// index is one pool for all of it. Names have to mean the world they are written in, so what a reference can see in the
// pool is limited to its own world's documents (a world's files, and the scripts of that world) and the built-in document.

/** The name of the world a node's document is written for. */
export const worldNameOf = (node: AstNode): string | undefined => (AstUtils.getDocument(node).parseResult.value as Model).World?.name;

/** Whether an element of the global index may be seen from the world named `world`. */
export function visibleFrom(world: string | undefined, description: AstNodeDescription, documents: LangiumDocuments): boolean {
    const owner = (documents.getDocument(description.documentUri)?.parseResult.value as Model | undefined)?.World?.name;
    return world === undefined || owner === undefined || owner === world || owner === BUILTIN_WORLD_NAME;
}
