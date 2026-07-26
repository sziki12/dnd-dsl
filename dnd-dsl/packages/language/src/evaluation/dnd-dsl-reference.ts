import type { AstNode } from "langium";
import type { Model } from "../generated/ast.js";
import type { DndDslServices } from "../dnd-dsl-module.js";
import type { SerializedAstNode, SerializedModel, SerializedRef } from "./dnd-dsl-serialized-types.js";

// All three Langium imports above are TYPE-ONLY (used only as TypeScript type
// annotations, never as runtime values).  Using `import type` ensures they are
// fully erased by the TypeScript / esbuild compiler so this file is safe to
// import in both the Node.js backend and the browser frontend.

export function parseReferenceFromModel<T extends AstNode>(model: Model, reference: SerializedRef): T | undefined {
    return resolveReference(model as any, reference);
}

export function parseReferenceFromSerializedModel<T extends SerializedAstNode>(model: SerializedModel, reference: SerializedRef): T | undefined {
    return resolveReference(model, reference);
}

function resolveReference<T>(model: any, reference: SerializedRef): T | undefined {
    // Strip leading '#' then the '/World/' prefix emitted by Langium's AstNodeLocator
    const raw = reference.$ref.startsWith('#') ? reference.$ref.slice(1) : reference.$ref;
    const stripped = raw.startsWith('/World/') ? raw.slice('/World/'.length) : raw.replace(/^\//, '');
    const parts = stripped.split('/').filter(Boolean);
    //console.log(`Resolving reference "${reference.$ref}" with parts:`, parts);
    if (parts.length === 0) return undefined;

    let current: any = model["World"];

    for (const part of parts) {
        //console.log(`Resolving part "${part}" in`, current);
        if (current === undefined || current === null) return undefined;
        if (part.includes('@')) {
            // e.g. "locations@2"  →  arrayName="locations", index=2
            // but also bare "@2" (root array element) →  arrayName="", index=2
            const atIdx = part.indexOf('@');
            const arrayName = part.slice(0, atIdx);
            const index = Number(part.slice(atIdx + 1));

            const arr = arrayName ? current[arrayName] : current;
            //console.log(`Resolving array part "${part}": arrayName="${arrayName}", index=${index}, arr=`, arr);
            if (!Array.isArray(arr)) return undefined;
            //console.log(`Accessing index ${index} of array:`, arr);
            current = arr[index];
        } else {
            current = current[part];
        }
    }

    return current as T;
}

export function convertNodeToReference(node: AstNode, services: DndDslServices): SerializedRef {
    const path = services.workspace.AstNodeLocator.getAstNodePath(node);
    return { $ref: `#${path}` };
}
