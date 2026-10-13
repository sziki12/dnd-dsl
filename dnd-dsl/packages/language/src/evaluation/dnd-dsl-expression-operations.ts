/**
 * Pure operator application shared by all three expression evaluators:
 * - LangiumInterpreterService.evaluateExpression (backend)
 * - evaluateSerializedExpression (dsl)
 * - expression-evaluator (frontend)
 * Operand-shape agnostic
 * caller resolves operands however its AST representation requires, then hands the
 * plain values here so the arithmetic / comparison / logical rules live in one place.
 */

import { append, concat, prepend, valuesEqual } from './dnd-dsl-predefined-functions.js';
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

function describeValue(value: unknown): string {
    if (value === undefined || value === null) return 'nothing';
    if (Array.isArray(value)) return 'a list';
    if (typeof value === 'string') return JSON.stringify(value);
    return typeof value === 'object' ? 'a record' : String(value);
}

function asIndex(index: unknown): number {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
        throw new Error(`A list is indexed by a whole number, not ${describeValue(index)}.`);
    }
    return index;
}

/**
 * `list[index]`: the item at a 0-based position, or nothing when the position is outside the list (a negative one included).
 *  Indexing anything that is not a list, or by anything that is not a whole number, is an error.
 */
export function applyIndex(list: unknown, index: unknown): unknown {
    if (!Array.isArray(list)) throw new Error(`Only a list can be indexed, not ${describeValue(list)}.`);
    const position = asIndex(index);
    return position < 0 ? undefined : list[position];
}

/**
 * A copy of `list` with the item at `indexes` replaced by `value` (several indexes reach into a list of lists).
 * Unlike a read, an index outside the list is an error, so a write is never silently lost.
 */
export function replaceAtIndexes(list: unknown, indexes: readonly unknown[], value: unknown): unknown[] {
    if (!Array.isArray(list)) throw new Error(`Only a list can be indexed, not ${describeValue(list)}.`);
    const [head, ...rest] = indexes;
    const position = asIndex(head);
    if (position < 0 || position >= list.length) {
        throw new Error(`Index ${position} is outside the list (it has ${list.length} item${list.length === 1 ? '' : 's'}).`);
    }
    const copy = [...list];
    copy[position] = rest.length === 0 ? value : replaceAtIndexes(list[position], rest, value);
    return copy;
}

/** Collection fields whose items have a name, so `x . field["name"]` can pick one. */
export const NAMED_COLLECTION_FIELDS: ReadonlySet<string> = new Set([
    'npcs', 'locations', 'sublocations', 'quests', 'objectives', 'events', 'functions', 'enums', 'values', 'exits',
]);
