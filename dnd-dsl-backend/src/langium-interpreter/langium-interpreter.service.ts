import { Code, CodeBlock, Expression, isConstantExpression, Model, ReferenceExpression } from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LangiumInterpreterService {

    evaluateExpression(worldState: any, expression: Expression): any {

        if(isConstantExpression(expression)){
            if(expression.$type === "IntVal" || expression.$type === "BoolVal" || expression.$type === "StringVal"){
                return expression.val;
            }

            if(expression.$type === "ObjectDeclaration"){
                return expression.variables.reduce((obj: any, variable) => {
                    obj[variable.target!] = this.evaluateExpression(worldState, variable.value!);
                    return obj;
                }, {});
            }
        }

        if(expression.$type === "GroupedExpression"){
            return `(${this.evaluateExpression(worldState, expression.exp)})`;
        } 
    }

    evaluateReference(worldState: any, expression: ReferenceExpression): any {
        if(expression.$type === "RefChain"){
            return expression.first;
            //TODO
        }
    }

    
    callFunction(params: callFunctionParams): any {

    }

    runCodeBlock(worldState: any, codeBlock: CodeBlock): any {
        codeBlock.code.forEach(code => {
            this.runCode(worldState, code);
        });
    }

    runCode(worldState: any, code: Code): any {
        if(code.$type === "FunctionCall"){
            return this.callFunction({
                worldState: worldState,
                target: code.target!.val.ref!.name,
                type: "name"
            });
        }

        if(code.$type === "VariableAssignment"){
            const value = this.evaluateExpression(worldState, code.value);
            const variableName = code.target.val.ref!.name!;
            worldState[variableName] = value;
        }
    }
}

type callFunctionParams = {
        worldState: any,
        target: string,
        type?: "reference" | "name",
    }
