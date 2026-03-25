import { BoolExpression, ConstantExpression, GroupedExpression, IntExpression, IntToBoolExpression, isObjectiveExpressions, isQuestExpressions, isReferenceExpression, ObjectiveExpressions, QuestExpressions, ReferenceExpression, VariableDeclaration } from "../../../language/src/generated/ast.js";

export type NestedExpression = GroupedExpression | IntExpression | IntToBoolExpression | BoolExpression
export type ExpressionType = NestedExpression | ReferenceExpression | ConstantExpression
export type PrimitiveType = string | number | boolean 
export function parseExpression(exp: ExpressionType | undefined): PrimitiveType {

    console.log("ExpressionType")
    if(exp?.$type == "BoolVal" || exp?.$type == "IntVal" || exp?.$type == "StringVal" || exp?.$type == "ObjectDeclaration")
    {
        console.log("IsConstantExpression")
        return parseConstantExpression(exp as ConstantExpression)
    }

    if(isReferenceExpression(exp))
    {
        console.log("IsReferenceExpression")
        return parseReferenceExpression(exp)
    }

    console.log("IsNestedExpression")
    return parseNestedExpression(exp)
   
}

//NestedExpression
export function parseNestedExpression(exp: NestedExpression | undefined): PrimitiveType
{
    if(exp?.$type == "GroupedExpression")
    {
        console.log("GroupedExpression")
        var grouped = exp.exp1
        return `(${parseExpression(grouped)})`
    }

    if(exp?.$type == "IntExpression" || exp?.$type == "IntToBoolExpression")
    {
        console.log("IntExpression || IntToBoolExpression")
        return `${parseExpression(exp.exp1)} ${exp.operator} ${parseExpression(exp.exp2)}`
    }

    if(exp?.$type == "BoolExpression")
    {
        console.log("BoolExpression")
        if(typeof(exp.exp1) == "undefined")
        {
            return "";
        }
        let output = `${parseExpression(exp.exp1)}`
        if(typeof(exp.operator) == "undefined" || (typeof(exp.exp2) == "undefined"))
        {
            return output
        }
        return `${output} ${exp.operator} ${parseExpression(exp.exp2)}`
    }

    throw Error(`Not parseable NestedExpression: ${exp}`)
}

//ReferenceExpression
export function parseReferenceExpression(exp: ReferenceExpression | undefined): PrimitiveType
{
    console.log("ReferenceExpression")

    if(exp?.$type == "EventCalledExpression")
    {
        const eventName = exp.target.val.ref?.name
        return `this.events[${eventName}()]`
    }

    if(exp?.$type == "FunctionCall")
    {
        const functionName = exp.target?.val.ref?.name
        let params = exp.params.map(exp => parseExpression(exp)).toString()
        params = params.substring(1, params.length - 2)
        return `this[${functionName}(${params})]`
    }

    if(exp?.$type == "RefChain")
    {
        //TODO RefChain
        return exp.val.toString()
    }

    if(isQuestExpressions(exp))
    {
        return parseQuestExpression(exp)
    }

    throw Error(`Not parseable ReferenceExpression: ${exp}`)
}

export function parseQuestExpression(exp: QuestExpressions): PrimitiveType
{
    const quest = exp.target.val
    if(exp?.$type == "QuestAcceptedExpression")
    {
        return `this.quests[${quest.ref?.name}]?.isAccepted`
    }

    if(exp?.$type == "QuestCompletedExpression")
    {
        return `this.quests[${quest.ref?.name}]?.isCompleted`
    }

    if(exp?.$type == "QuestFailedExpression")
    {
        return `this.quests[${quest.ref?.name}]?.isFailed`
    }

    if(isObjectiveExpressions(exp))
    {
        return parseObjectiveExpression(exp)
    }

    throw Error(`Not parseable QuestExpression: ${exp}`)
}

export function parseObjectiveExpression(exp: ObjectiveExpressions): PrimitiveType
{
    const objective = exp.target.val
    const parentQuest = objective.ref?.$container
    if(exp?.$type == "ObjectiveCompletedExpression")
    {
        return `this.quests[${parentQuest?.name}]?.objectives[${objective.ref?.name}]?.isCompleted`
    }

    if(exp?.$type == "ObjectiveFailedExpression")
    {
        return `this.quests[${parentQuest?.name}]?.objectives[${objective.ref?.name}]?.isFailed`
    }

    throw Error(`Not parseable ObjectiveExpression: ${exp}`)
}



//ConstantExpression
export function parseConstantExpression(exp: ConstantExpression | undefined): PrimitiveType
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
        console.log("ObjectDeclaration")
        return JSON.stringify(mapVariablesToObject(exp.variables))
    }

    throw Error(`Not parseable ConstantExpression: ${exp}`)
}

export function mapVariablesToObject(variables : VariableDeclaration[])
{
    let object: any = {}
    for (let variable of variables)
    {
        object[variable.name] = parseExpression(variable.value)
    }
    return object
}