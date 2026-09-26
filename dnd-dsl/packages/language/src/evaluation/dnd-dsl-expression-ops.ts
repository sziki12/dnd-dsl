/**
 * Pure operator application shared by all three expression evaluators:
 * - LangiumInterpreterService.evaluateExpression (backend)
 * - evaluateSerializedExpression (dsl)
 * - expression-evaluator (frontend)
 * Operand-shape agnostic
 * caller resolves operands however its AST representation requires, then hands the
 * plain values here so the arithmetic / comparison / logical rules live in one place.
 */

import { append, concat, prepend, valuesEqual } from './dnd-dsl-list-ops.js';
import type { JsonRuntimeValue } from './dnd-dsl-value-evaluator.js';

export type ArithmeticOperator = '+' | '-' | '*' | '/';
export type ComparisonOperator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'is';
export type LogicalOperator = 'and' | 'or';

export function applyArithmetic(operator: ArithmeticOperator, left: unknown, right: unknown): number | string | JsonRuntimeValue[] | undefined {
    // Arithmetic if both sides are numbers, dividing by zero returns undefined
    if (typeof left === 'number' && typeof right === 'number')
    {
        switch (operator) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return right !== 0 ? left / right : undefined;
        }
    }
    // String concatenation if either side is a string
    else if (operator === '+' && (typeof left === 'string'  || typeof right === 'string')) {
        return left as string + right as string;
    }
    // Array concatrenation, or append/prepend if one side is not an array
    else if (operator === '+' && Array.isArray(left) && Array.isArray(right)) {
        return concat(left, right) as JsonRuntimeValue[];
    }
    else if (operator === '+' && Array.isArray(left)) {
        return append(left, right) as JsonRuntimeValue[];
    }
    else if (operator === '+' && Array.isArray(right)) {
        return prepend(right, left) as JsonRuntimeValue[];
    }
    
    return undefined;
}

/**
 * `== != is` compare any operands by identity, except lists which compare item by item
 * (`is` also honours a `negated` flag). `< > <= >=` require two numbers, otherwise
 * undefined.
 */
export function applyComparison(operator: ComparisonOperator, left: unknown, right: unknown, negated = false): boolean | undefined {
    switch (operator) {
        case '==': return valuesEqual(left, right);
        case '!=': return !valuesEqual(left, right);
        case 'is': return negated ? !valuesEqual(left, right) : valuesEqual(left, right);
    }
    if (typeof left !== 'number' || typeof right !== 'number') return undefined;
    switch (operator) {
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
    }
    return undefined;
}

/** `and` / `or` returning a strict boolean; `right` is a thunk so it short-circuits */
export function applyLogical(operator: LogicalOperator, left: unknown, right: () => unknown): boolean {
    return operator === 'and'
        ? Boolean(left) && Boolean(right())
        : Boolean(left) || Boolean(right());
}

/** `IntVal` to its signed number */
export function signedInt(node: { isNegative?: boolean; val: number }): number {
    return node.isNegative ? -node.val : node.val;
}

/** `BoolVal` to its (possibly negated) boolean */
export function negatableBool(node: { isNegated?: boolean; val: boolean }): boolean {
    return node.isNegated ? !node.val : node.val;
}
