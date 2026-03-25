import {type Model } from '../../language/src/generated/ast.js';
import { expandToNode, joinToNode, toString } from 'langium/generate';
import { extractDestinationAndName, writeToFile } from './util.js';
import { parseLocations } from './parser/location-parser.js';

export function generateJavaScript(model: Model, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const fileName = `${data.name}.js`;

    const fileNode = expandToNode`
        "use strict";

        ${joinToNode(model.World.locations, location => `console.log('Hello, ${location.name}!');`, { appendNewLineIfNotEmpty: true })}
    `.appendNewLineIfNotEmpty();

    const generatedFilePath = writeToFile(data.destination, fileName, toString(fileNode))
    return generatedFilePath;
}

export function generateWorldState(model: Model, filePath: string, destination: string | undefined): string {
     const data = extractDestinationAndName(filePath, destination);
    const fileName = `${data.name}.js`;

    const fileNode = expandToNode`
        "use strict";
        export function getWorldState() {
            return {
                "locations": ${JSON.stringify(parseLocations(model.World.locations)).replace(',',',\n')}
            }
        }
    `.appendNewLineIfNotEmpty();

    const generatedFilePath = writeToFile(data.destination, fileName, toString(fileNode))
    return generatedFilePath;
}

    
