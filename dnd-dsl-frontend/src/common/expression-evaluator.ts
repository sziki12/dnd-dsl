import type { SerializedModel, SerializedNode, SerializedVariableDecl } from './model-types';
import type {
    Expression, BoolVal, IntVal, StringVal,
    IntExpression, BoolExpression, IntToBoolExpression, GroupedExpression,
    ObjectDeclaration,
} from '../dnd-language/language/src/generated/ast';

export type SerialisedObjectDeclaration = {
    name: string,
    /** Pre-evaluated values for non-computed sub-properties */
    staticProperties: Record<string, EvalResult | undefined>,
    /** Original declarations for computed sub-properties — evaluated on demand */
    computedPropertyDecls: SerializedVariableDecl[],
};

export type EvalResult = number | boolean | string | SerialisedObjectDeclaration;

export type EvaluateExpressionOptions = {
    variableName?: string,
    worldState?: SerializedModel,
}

export function evaluateExpression(expr: SerializedNode<Expression> | undefined, options?: EvaluateExpressionOptions): EvalResult | undefined {
    if (!expr) return undefined;

    switch (expr.$type) {
        case 'BoolVal': {
            const e = expr as unknown as SerializedNode<BoolVal>;
            return e.isNegated ? !e.val : e.val;
        }
        case 'IntVal': {
            const e = expr as unknown as SerializedNode<IntVal>;
            return e.isNegative ? -e.val : e.val;
        }
        case 'StringVal': {
            const e = expr as unknown as SerializedNode<StringVal>;
            return e.val;
        }
        case 'IntExpression': {
            const e = expr as SerializedNode<IntExpression>;
            const left = evaluateExpression(e.left, options);
            const right = evaluateExpression(e.right, options);
            if (typeof left !== 'number' || typeof right !== 'number') return undefined;
            switch (e.operator) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/': return right !== 0 ? left / right : undefined;
            }
            break;
        }
        case 'BoolExpression': {
            const e = expr as SerializedNode<BoolExpression>;
            const left = evaluateExpression(e.left, options);
            const right = evaluateExpression(e.right, options);
            if (e.operator === 'and') return Boolean(left) && Boolean(right);
            if (e.operator === 'or') return Boolean(left) || Boolean(right);
            break;
        }
        case 'IntToBoolExpression': {
            const e = expr as SerializedNode<IntToBoolExpression>;
            const left = evaluateExpression(e.left, options);
            const right = evaluateExpression(e.right, options);
            if (typeof left !== 'number' || typeof right !== 'number') return undefined;
            switch (e.operator) {
                case '==': return left === right;
                case '!=': return left !== right;
                case '<':  return left < right;
                case '<=': return left <= right;
                case '>':  return left > right;
                case '>=': return left >= right;
            }
            break;
        }
        case 'GroupedExpression': {
            const e = expr as SerializedNode<GroupedExpression>;
            return evaluateExpression(e.exp, options);
        }
        case 'ObjectDeclaration': {
            const e = expr as unknown as SerializedNode<ObjectDeclaration>;
            const staticVars = e.variables.filter(v => v.isComputed !== 'computed');
            const computedVars = e.variables.filter(v => v.isComputed === 'computed');
            return {
                name: options?.variableName ?? "Object",
                staticProperties: Object.fromEntries(
                    staticVars.map(v => [v.target ?? '', evaluateExpression(v.value, options)])
                ),
                computedPropertyDecls: computedVars as SerializedVariableDecl[],
            };
        }
        case 'Expression':
            return evaluateExpression(expr.exp, options);

        case 'FunctionCall': {
            if(!options?.worldState)
                return undefined;

            // TODO Call function on Backend
            return 0;
        }
        case 'RefChain': {
            if(!options?.worldState)
                return undefined;

            return undefined;
            // TODO Resolve reference chain on Backend
        }
    }

    // FunctionCall, RefChain, EventCalledExpression, quest/objective expressions etc.
    // can't be resolved without runtime state — caller decides how to display these
    return undefined;
}
