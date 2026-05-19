import {
    Code,
    CodeBlock,
    ConditionalBlock,
    Expression,
    FunctionCall,
    FunctionDeclaration,
    isBoolExpression,
    isBoolVal,
    isFunctionCall,
    isGroupedExpression,
    isIntExpression,
    isIntToBoolExpression,
    isIntVal,
    isObjectDeclaration,
    isRefChain,
    isStringVal,
    Model,
    RefChain,
    ReturnStatement,
    VariableDeclaration,
} from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';

type RuntimeScope = Record<string, any>;

class ReturnSignal {
    constructor(public readonly value: any) {}
}

@Injectable()
export class LangiumInterpreterService {

    private readonly predefinedFunctions: Record<string, (...args: any[]) => any> = {
        randomfv: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    };

    evaluateExpression(scope: RuntimeScope, expression: Expression): any {
        if (isIntVal(expression)) {
            return expression.isNegative ? -expression.val : expression.val;
        }
        if (isBoolVal(expression)) {
            return expression.isNegated ? !expression.val : expression.val;
        }
        if (isStringVal(expression)) {
            return expression.val;
        }
        if (isObjectDeclaration(expression)) {
            return expression.variables.reduce((obj: RuntimeScope, v) => {
                const name = v.target ?? v.name ?? '';
                obj[name] = v.value ? this.evaluateExpression(scope, v.value) : undefined;
                return obj;
            }, {});
        }
        if (isGroupedExpression(expression)) {
            return this.evaluateExpression(scope, expression.exp);
        }
        if (isIntExpression(expression)) {
            const l = this.evaluateExpression(scope, expression.left);
            const r = this.evaluateExpression(scope, expression.right);
            switch (expression.operator) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return r !== 0 ? l / r : 0;
            }
        }
        if (isIntToBoolExpression(expression)) {
            const l = this.evaluateExpression(scope, expression.left);
            const r = this.evaluateExpression(scope, expression.right);
            switch (expression.operator) {
                case '==': return l === r;
                case '!=': return l !== r;
                case '<':  return l < r;
                case '>':  return l > r;
                case '<=': return l <= r;
                case '>=': return l >= r;
            }
        }
        if (isBoolExpression(expression)) {
            const l = this.evaluateExpression(scope, expression.left);
            if (expression.operator === 'and') return l && this.evaluateExpression(scope, expression.right);
            if (expression.operator === 'or')  return l || this.evaluateExpression(scope, expression.right);
        }
        if (isRefChain(expression)) {
            return this.evaluateRefChain(scope, expression);
        }
        if (isFunctionCall(expression)) {
            return this.executeFunctionCall(scope, expression);
        }

        if(expression.$type === 'Expression'){
            return this.evaluateExpression(scope, expression.exp);
        }

        throw new Error(`Unhandled expression type: ${expression.$type}`);
    }

    private evaluateRefChain(scope: RuntimeScope, chain: RefChain): any {
        const first = chain.first;
        if (first.$type === 'VariableRefItem') {
            const decl = first.val.val.ref;
            const name = decl?.target ?? decl?.name;
            if (name === undefined) throw new Error(`Unresolved variable ref: ${first.val.val.$refText}`);
            return scope[name];
        }
        // TODO: location/quest/event chain traversal
        throw new Error(`Unhandled RefChainStart type: ${first.$type}`);
    }

    executeFunctionCall(scope: RuntimeScope, call: FunctionCall): any {
        const args = call.params.map(p => this.evaluateExpression(scope, p));

        if (call.predefined) {
            const fn = this.predefinedFunctions[call.predefinedTarget!];
            if (!fn) throw new Error(`Unknown predefined function: ${call.predefinedTarget}`);
            return fn(...args);
        }

        const decl = call.target?.val.ref;
        if (!decl) throw new Error(`Unresolved function ref: ${call.target?.val.$refText}`);
        return this.callFunctionDecl(scope, decl, args);
    }

    triggerEventByName(model: Model, eventName: string, scope: RuntimeScope) {
        const eventDecl = model.World.events.find(e => e.name === eventName);
        if (!eventDecl) throw new Error(`Event '${eventName}' not found`);
        if(!eventDecl.codeBlock) return;
        this.runCodeBlock(scope, eventDecl.codeBlock);
    }

    /**
     * Look up a function by name in the parsed model and execute it.
     * Returns the function's return value, or undefined if the function has no return statement.
     */
    callFunctionByName(model: Model, functionName: string, args: any[], scope: RuntimeScope): any {
        let decl = model.World.functions.find(f => f.name === functionName);
        if(!decl) {
            console.log("Calling predefined function:", functionName, args);
            const predefined = this.predefinedFunctions[functionName];
            if (!predefined) throw new Error(`Function '${functionName}' not found`);

            const result = predefined(...args);
            console.log(`Function '${functionName}' returned:`, result);
            return result;
        }
        if (!decl) throw new Error(`Function '${functionName}' not found`);
        console.log("Calling function:", functionName, args);
        return this.callFunctionDecl(scope, decl, args);
    }

    private callFunctionDecl(callerScope: RuntimeScope, decl: FunctionDeclaration, args: any[]): any {
        const localScope: RuntimeScope = Object.create(callerScope);

        decl.params.forEach((param, i) => {
            const name = param.name ?? param.target ?? '';
            localScope[name] = args[i];
        });

        if (!decl.codeBlock) return undefined;

        const result = this.runCodeBlock(localScope, decl.codeBlock);
        console.log(`Function '${decl.name}' returned:`, result instanceof ReturnSignal ? result.value : undefined);
        return result instanceof ReturnSignal ? result.value : undefined;
    }

    runCodeBlock(scope: RuntimeScope, codeBlock: CodeBlock): ReturnSignal | undefined {
        for (const code of codeBlock.code) {
            const result = this.runCode(scope, code);
            if (result instanceof ReturnSignal) return result;
        }
        return undefined;
    }

    runCode(scope: RuntimeScope, code: Code): ReturnSignal | undefined {
        switch (code.$type) {
            case 'VariableDeclaration': {
                const c = code as VariableDeclaration;
                const name = c.target ?? '';
                scope[name] = c.value ? this.evaluateExpression(scope, c.value) : undefined;
                break;
            }
            case 'VariableAssignment': {
                const decl = code.target.val.ref;
                const name = decl?.target ?? decl?.name ?? '';
                scope[name] = this.evaluateExpression(scope, code.value);
                break;
            }
            case 'FunctionCall': {
                const c = code as unknown as FunctionCall;
                this.executeFunctionCall(scope, c);
                break;
            }
            case 'ReturnStatement': {
                const c = code as unknown as ReturnStatement;
                const value = c.returnValue ? this.evaluateExpression(scope, c.returnValue) : undefined;
                return new ReturnSignal(value);
            }
            case 'ConditionalBlock': {
                const c = code as unknown as ConditionalBlock;
                const condition = this.evaluateExpression(scope, c.condition);
                if (condition) {
                    for (const block of c.body) {
                        const result = this.runCodeBlock(scope, block);
                        if (result instanceof ReturnSignal) return result;
                    }
                }
                break;
            }
            case 'EventTrigger': {
                // TODO: dispatch event execution
                break;
            }
        }
        return undefined;
    }
}
