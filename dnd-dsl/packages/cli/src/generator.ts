import {Location, Quest, ReferenceExpression, VariableAssignment, VariableDeclaration, Event, type Model } from '../../language/src/generated/ast.js';
import { expandToNode, joinToNode, toString } from 'langium/generate';
import { extractDestinationAndName, writeToFile } from './util.js';


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

/*export function generateWorldState(model: Model, filePath: string, destination: string | undefined): string {
     const data = extractDestinationAndName(filePath, destination);
    const fileName = `${data.name}.js`;

    var worldState : any = {}
    worldState["locations"] = parseLocations(model.World.locations, true)
    const fileNode = expandToNode`
        "use strict";
        export function getWorldState() {
            return ${JSON.stringify(worldState, null, 2)}
        }

        export function callFunction(name, options) {
            let worldState = options["worldState"]

            if(options.isPredefined)
            {
                return worldState.functions[name](...options.params)
            }
            return worldState.functions[name](...options.params)
        }

        export function callPredefinedFunction(name, options) {
            let worldState = options["worldState"]

            //TODO Resolve predefined functions
            return undefined//worldState.functions[name](...options.params)
        }
        
        export function initWorldState(worldState) {
            ${joinToNode(InitVariables, variableInit => writeInitableWariable(variableInit), { appendNewLineIfNotEmpty: true })}
        }
    `.appendNewLineIfNotEmpty();
    

    const generatedFilePath = writeToFile(data.destination, fileName, toString(fileNode))
    return generatedFilePath;
}

function writeInitableWariable(variableInit: InitableExpression | undefined): string
{
    if(typeof(variableInit) == "undefined")
        return ""

    if(variableInit.initable.$type == "VariableAssignment")
    {
        return `worldState["${variableInit?.initable.target}"]=${parseExpression(variableInit.initable?.value, "Assignment")}`
    }
    if(variableInit.initable.$type == "VariableDeclaration")
    {
        return `worldState["${variableInit.initable?.target}"]=${parseExpression(variableInit.initable?.value, "Assignment")}`
    }
    else
    {
        return parseExpression(variableInit.initable, "Assignment").toString()
    }
}

export function addToInit(variableInit: Initable)
{
    InitVariables.push({
        prefix: resolveCurrentReference(),
        initable: variableInit
    })
}

export function pushCurrentReference(obj: Chainable)
{
    CurrentReferenceChain.push(obj)
}

export function popCurrentReference(): Chainable | undefined
{
   return CurrentReferenceChain.pop()
}

function resolveCurrentReference(): string
{
    resolveObject([])
    return ""
    //return ""
}

function resolveObject(chainable: Chainable[]): string
{
    if(chainable.length == 0)
        return ""

    let firstItem = chainable[0]
    let name: string
    let basePath: string | undefined
    if(typeof(firstItem) == "string")
    {
        name = firstItem
    }
    else
    {
        switch (firstItem.$type)
        {
            case "Event":
                basePath="events"
            break
            case "Location":
                basePath="locations"
            break
            case "Quest":
                basePath="quests"
            break;
        }
        name = firstItem.name!
    }
    return `${typeof(basePath) != "undefined" ? `.["${basePath}"]` : ""}["${name}${resolveObject(chainable.slice(1))}"]`
}*/