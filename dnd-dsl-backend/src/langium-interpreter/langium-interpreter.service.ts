import { Model } from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LangiumInterpreterService {

    parseReference(model: Model, reference: string): any {
        var referencePath = reference.split("#/World/")[1].split("/");
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
}
