/**
 * Pure operator application shared by all three expression evaluators:
 * LangiumInterpreterService.evaluateExpression (live AST), evaluateSerializedExpression
 * (this folder), and the frontend expression-evaluator. Operand-shape agnostic - each
 * caller resolves operands however its AST representation requires, then hands the
 * plain values here so the arithmetic / comparison / logical rules live in one place.
 */

export type ArithmeticOperator = '+' | '-' | '*' | '/';
export type ComparisonOperator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'is';
export type LogicalOperator = 'and' | 'or';

/** `+ - * /` on two numbers. Non-numeric operands or divide-by-zero give undefined. */
export function applyArithmetic(operator: ArithmeticOperator, left: unknown, right: unknown): number | undefined {
    if (typeof left !== 'number' || typeof right !== 'number') return undefined;
    switch (operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right !== 0 ? left / right : undefined;
    }
    return undefined;
}

/**
 * `== != is` compare any operands by identity (`is` also honours a `negated` flag).
 * `< > <= >=` require two numbers, otherwise undefined.
 */
export function applyComparison(operator: ComparisonOperator, left: unknown, right: unknown, negated = false): boolean | undefined {
    switch (operator) {
        case '==': return left === right;
        case '!=': return left !== right;
        case 'is': return negated ? left !== right : left === right;
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

/** `and` / `or` returning a strict boolean; `right` is a thunk so it short-circuits. */
export function applyLogical(operator: LogicalOperator, left: unknown, right: () => unknown): boolean {
    return operator === 'and'
        ? Boolean(left) && Boolean(right())
        : Boolean(left) || Boolean(right());
}

/** `IntVal` to its signed number. */
export function signedInt(node: { isNegative?: boolean; val: number }): number {
    return node.isNegative ? -node.val : node.val;
}

/** `BoolVal` to its (possibly negated) boolean. */
export function negatableBool(node: { isNegated?: boolean; val: boolean }): boolean {
    return node.isNegated ? !node.val : node.val;
}
