import { AstNode } from "langium";
import { Model } from "../generated/ast.js";
import { DndDslServices } from "../dnd-dsl-module.js";
import { SerializedAstNode, SerializedModel, SerializedRef } from "./dnd-dsl-serialized-types.js";

export function parseReferenceFromModel<T extends AstNode>(model: Model, reference: SerializedRef): T | undefined {
    return resolveReference(model, reference);
}


export function parseReferenceFromSerializedModel<T extends SerializedAstNode>(model: SerializedModel, reference: SerializedRef): T | undefined {
    return resolveReference(model, reference);
}

function resolveReference<T extends AstNode | SerializedAstNode>(model: Model | SerializedModel, reference: SerializedRef): T | undefined {
    var referencePath = reference.$ref.split("#/World/")[1].split("/");
    if(referencePath.length == 0)            
        return undefined;
    var current : any = model;
    for(let i = 0; i < referencePath.length; i++){
        var part = referencePath[i];
        console.log(`Resolving part: ${part}`);
        if(current[part] === undefined)
            return undefined;

        if(part.includes("@")){
            var [arrayName, id] = part.split("@");
            if(current[arrayName] === undefined || !Array.isArray(current[arrayName]))
                return undefined;

            current = current[arrayName][id];
            if(current === undefined)
                return undefined;
        }
        else{
            current = current[part];
        }
    }
    return current;
}


export function convertNodeToReference(node: AstNode, services: DndDslServices): SerializedRef
{
    const path = services.workspace.AstNodeLocator.getAstNodePath(node);
    return { $ref: `#${path}` };
}

