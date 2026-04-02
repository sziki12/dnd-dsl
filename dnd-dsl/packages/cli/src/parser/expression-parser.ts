/*import { BoolExpression, ConstantExpression, Expression, GroupedExpression, IntExpression, IntToBoolExpression, isObjectiveExpressions, isQuestExpressions, isReferenceExpression, ObjectiveExpressions, QuestExpressions, RefChain, ReferenceExpression, VariableDeclaration } from "../../../language/src/generated/ast.js";
import { addToInit, popCurrentReference, pushCurrentReference } from "../generator.js";
import { Reference } from "langium"

export type NestedExpression = GroupedExpression | IntExpression | IntToBoolExpression | BoolExpression | Expression
export type ExpressionType = NestedExpression | ReferenceExpression | ConstantExpression
export type PrimitiveType = string | number | boolean

let currentVariableDeclaration: VariableDeclaration
export function parseExpression(exp: ExpressionType | undefined, mode: "Declaration" | "Assignment"): PrimitiveType {

    console.log("ExpressionType")

    if(exp?.$type == "BoolVal" || exp?.$type == "IntVal" || exp?.$type == "StringVal" || exp?.$type == "ObjectDeclaration")
    {
        console.log("IsConstantExpression")
        return parseConstantExpression(exp as ConstantExpression, mode)
    }

    if(isReferenceExpression(exp))
    {
        console.log("IsReferenceExpression")
        return parseReferenceExpression(exp, mode)
    }

    console.log("IsNestedExpression")
    return parseNestedExpression(exp, mode)
}

//NestedExpression
export function parseNestedExpression(exp: NestedExpression | undefined, mode: "Declaration" | "Assignment"): PrimitiveType
{
    if(exp?.$type == "Expression")
    {
        return ""
    }
    
    if(exp?.$type == "GroupedExpression")
    {
        console.log("GroupedExpression")
        var grouped = exp.exp1
        return `(${parseExpression(grouped, mode)})`
    }

    if(exp?.$type == "IntExpression" || exp?.$type == "IntToBoolExpression")
    {
        console.log("IntExpression || IntToBoolExpression")
        return `${parseExpression(exp.exp1, mode)} ${exp.operator} ${parseExpression(exp.exp2, mode)}`
    }

    if(exp?.$type == "BoolExpression")
    {
        console.log("BoolExpression")
        if(typeof(exp.exp1) == "undefined")
        {
            return "";
        }
        let output = `${parseExpression(exp.exp1, mode)}`
        if(typeof(exp.operator) == "undefined" || (typeof(exp.exp2) == "undefined"))
        {
            return output
        }
        return `${output} ${exp.operator} ${parseExpression(exp.exp2, mode)}`
    }

    throw Error(`Not parseable NestedExpression: ${exp}`)
}

//ReferenceExpression
export function parseReferenceExpression(exp: ReferenceExpression | undefined, mode: "Declaration" | "Assignment"): PrimitiveType
{
    console.log("ReferenceExpression")

    
    if(exp?.$type == "EventCalledExpression")
    {
        if(mode == "Declaration")
        {
            addToInit(currentVariableDeclaration)
            return true;
        }
        else(mode == "Assignment")
        {
            checkRef(exp.target!.val, exp)
            const eventName = exp.target.val.ref?.name
            return `this.callEvent("${eventName}")`
        }
    }

    if(exp?.$type == "FunctionCall")
    {
        if(mode == "Declaration")
        {
            addToInit(currentVariableDeclaration)
            return 0;
        }
        else if(mode == "Assignment")
        {
            checkRef(exp.target!.val, exp)
            if(exp.predefined)
            {
                const functionName = exp.target?.val.ref?.name
                let params = exp.params.map(exp => parseExpression(exp, mode)).toString()
                return `callPredefinedFunction("${functionName}", {params: [${params}], isPredefined: ${exp.predefined}, worldState: worldState})`
            }
            else
            {
                const functionName = exp.target?.val.ref?.name
                let params = exp.params.map(exp => parseExpression(exp, mode)).toString()
                return `callFunction("${functionName}", {params: [${params}], worldState: worldState})`
            }
        }
    }

    if(exp?.$type == "RefChain")
    {
        if(mode == "Declaration")
        {
            addToInit(currentVariableDeclaration)
            return 0;
        }
        else if(mode == "Assignment")
        {
            if(exp.isEvent)
            {
                return resolveReference(exp, "events")
            }
            else if(exp.isLocation)
            {
                return resolveReference(exp, "locations")
            }
            else if(exp.isQuest)
            {
                return resolveReference(exp, "quests")
            }

            return exp.val.toString()
        }
        //TODO RefChain        
    }

    if(isQuestExpressions(exp))
    {
        return parseQuestExpression(exp, mode)
    }

    throw Error(`Not parseable ReferenceExpression: ${exp}`)
}

export function parseQuestExpression(exp: QuestExpressions, mode: "Declaration" | "Assignment"): PrimitiveType
{
    checkRef(exp.target.val, exp)
    const questName = exp.target.val.ref?.name

    if(mode == "Declaration")
    {
        addToInit(currentVariableDeclaration)
        return true
    }
        else if(mode == "Assignment")
        {
            if(exp?.$type == "QuestAcceptedExpression")
            {
                return `this.quests["${questName}"]?.isAccepted`
            }

            if(exp?.$type == "QuestCompletedExpression")
            {
                return `this.quests["${questName}"]?.isCompleted`
            }

            if(exp?.$type == "QuestFailedExpression")
            {
                return `this.quests["${questName}"]?.isFailed`
            }

            if(isObjectiveExpressions(exp))
            {
                return parseObjectiveExpression(exp, mode)
            }
    }
    
    throw Error(`Not parseable QuestExpression: ${exp}`)
}

export function parseObjectiveExpression(exp: ObjectiveExpressions, mode: "Declaration" | "Assignment"): PrimitiveType
{
    const objective = exp.target.val
    checkRef(objective, exp)
    const parentQuest = objective.ref?.$container

    if(mode == "Declaration")
    {
        addToInit(currentVariableDeclaration)
        return true
    }
    else if(mode == "Assignment")
    {
        if(exp?.$type == "ObjectiveCompletedExpression")
        {
            return `this.quests["${parentQuest?.name}"]?.objectives["${objective.ref?.name}"]?.isCompleted`
        }

        if(exp?.$type == "ObjectiveFailedExpression")
        {
            return `this.quests["${parentQuest?.name}"]?.objectives["${objective.ref?.name}"]?.isFailed`
        }
    }

    throw Error(`Not parseable ObjectiveExpression: ${exp}`)
}



//ConstantExpression
export function parseConstantExpression(exp: ConstantExpression | undefined, mode: "Declaration" | "Assignment"): PrimitiveType
{
    if(exp?.$type == "StringVal")
    {
        console.log("String")
        return exp.val
    }

    if(exp?.$type == "IntVal")
    {
        console.log("Int")
        return exp.isNegative ? -exp.val : exp.val
    }

    if(exp?.$type == "BoolVal")
    {
        console.log("Bool")
        return exp.val
    }

    if(exp?.$type == "ObjectDeclaration")
    {
        //TODO Investigate
        console.log("ObjectDeclaration")
        return mapVariablesToObject(exp.variables, mode)
    }

    throw Error(`Not parseable ConstantExpression: ${exp}`)
}

export function mapVariablesToObject(variables : VariableDeclaration[], mode: "Declaration" | "Assignment"): any
{
    let object: any = {}
    for (let variable of variables)
    {
        currentVariableDeclaration = variable
        pushCurrentReference(variable.target!)
        object[variable.target!] = parseExpression(variable.value, mode)
        popCurrentReference()
    }
    return object
}

function resolveReference(refChain: RefChain, basePath: string | undefined = undefined): string
{
    return `this${typeof(basePath) != "undefined" ? `.["${basePath}"]` : ""}["${refChain.val[0]}${refChain.val.slice(1).map(val => `.${val.val.ref?.name}`)}"]`
}

function checkRef(ref: Reference, exp: ExpressionType)
{ 
    if (!ref.ref) {
        // Ha undefined, logold a $refText-et diagnosztikához
        throw new Error(
            `Unresolved reference '${ref.$refText}' at ` +
            `${exp.$cstNode?.range.start.line}:${exp.$cstNode?.range.start.character}`
        );
    }
    else{
        console.log("Ref is good")
        console.log(ref.ref.$type)
    }
}*/