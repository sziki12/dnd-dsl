import type { SerializedModel, SerializedNode, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { evaluateSerializedExpression } from '@dnd-language/evaluation/dnd-dsl-value-evaluator.js';
import type { Expression } from '../dnd-language/language/src/generated/ast';

export type SerialisedObjectDeclaration = {
    name: string,
    /** Pre-evaluated values for non-computed sub-properties */
    staticProperties: Record<string, EvalResult | undefined>,
    /** Original declarations for computed sub-properties - evaluated on demand */
    computedPropertyDecls: SerializedVariableDecl[],
};

export type EvalResult = number | boolean | string | SerialisedObjectDeclaration | Array<EvalResult | undefined>;

export type InferredKind = 'int' | 'string' | 'bool' | 'object' | 'list' | 'unknown';

/** An object result is a SerialisedObjectDeclaration - an array is also `typeof 'object'`,
 *  so every place that reads `staticProperties` must go through this guard. */
export function isObjectResult(value: unknown): value is SerialisedObjectDeclaration {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** SerializedVariableDecl has no `kind` field - infer a display kind from the runtime-evaluated value. */
export function inferKind(value: EvalResult | null | undefined): InferredKind {
    switch (typeof value) {
        case 'number': return 'int';
        case 'string': return 'string';
        case 'boolean': return 'bool';
        case 'object': return value === null ? 'unknown' : Array.isArray(value) ? 'list' : 'object';
        default: return 'unknown';
    }
}

export type EvaluateExpressionOptions = {
    variableName?: string,
    worldState?: SerializedModel,
}

/**
 * Builds the object shape the pages render. Static members are evaluated here; computed ones stay declarations so a
 * page evaluates each one when it draws it. `variableName` is the variable holding the object, if known.
 * `evaluate(expr, name?)` evaluates a member with the same options; a `name` given there becomes the variable name
 * of any object inside that member.
 */
function toObjectDeclaration(
    variables: SerializedVariableDecl[],
    variableName: string | undefined,
    evaluate: (expr: unknown, variableName?: string) => EvalResult | undefined,
): SerialisedObjectDeclaration {
    
    return {
        name: variableName ?? 'object',
        staticProperties: Object.fromEntries(
            variables
                .filter(v => v.isComputed !== 'computed')
                .map(v => [v.target, evaluate(v.value, v.target)]),
        ),
        computedPropertyDecls: variables.filter(v => v.isComputed === 'computed'),
    };
}

/** The canonical evaluator, lenient because it runs during render, with the pages' object shape. */
export function evaluateExpression(expr: SerializedNode<Expression> | undefined, options?: EvaluateExpressionOptions): EvalResult | undefined {
    return evaluateSerializedExpression(options?.worldState, expr, {
        lenient: true,
        variableName: options?.variableName,
        objectOf: (variables, variableName, evaluate) =>
            toObjectDeclaration(variables, variableName, evaluate as (expr: unknown, variableName?: string) => EvalResult | undefined) as never,
    }) as EvalResult | undefined;
}
