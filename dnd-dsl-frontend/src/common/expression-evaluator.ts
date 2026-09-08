import type { SerializedEnumValueDecl, SerializedModel, SerializedNode, SerializedRefChain, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { resolveSerializedRefChain } from '@dnd-language/evaluation/dnd-dsl-value-evaluator.js';
import { parseReferenceFromSerializedModel } from '@dnd-language/evaluation/dnd-dsl-reference.js';
import {
    applyArithmetic,
    applyComparison,
    applyLogical,
    negatableBool,
    signedInt,
    type ArithmeticOperator,
    type ComparisonOperator,
    type LogicalOperator,
} from '@dnd-language/evaluation/dnd-dsl-expression-ops.js';
import type {
    Expression, BoolVal, IntVal, StringVal,
    IntExpression, BoolExpression, IntToBoolExpression, GroupedExpression,
    ObjectDeclaration,
} from '../dnd-language/language/src/generated/ast';

export type SerialisedObjectDeclaration = {
    name: string,
    /** Pre-evaluated values for non-computed sub-properties */
    staticProperties: Record<string, EvalResult | undefined>,
    /** Original declarations for computed sub-properties - evaluated on demand */
    computedPropertyDecls: SerializedVariableDecl[],
};

export type EvalResult = number | boolean | string | SerialisedObjectDeclaration;

export type InferredKind = 'int' | 'string' | 'bool' | 'object' | 'unknown';

/** SerializedVariableDecl has no `kind` field - infer a display kind from the runtime-evaluated value. */
export function inferKind(value: EvalResult | null | undefined): InferredKind {
    switch (typeof value) {
        case 'number': return 'int';
        case 'string': return 'string';
        case 'boolean': return 'bool';
        case 'object': return value === null ? 'unknown' : 'object';
        default: return 'unknown';
    }
}

export type EvaluateExpressionOptions = {
    variableName?: string,
    worldState?: SerializedModel,
}

export function evaluateExpression(expr: SerializedNode<Expression> | undefined, options?: EvaluateExpressionOptions): EvalResult | undefined {
    if (!expr) return undefined;

    // An ASSIGN_VARIABLE overlay write replaces a leaf VariableDeclaration.value with a
    // bare JS primitive, no $type tag at all (see WorldStateService.spliceOverlayValue) -
    // without this check, every overlaid leaf would silently evaluate to `undefined`.
    if (typeof expr !== 'object') return expr as EvalResult;

    switch (expr.$type) {
        case 'BoolVal':
            return negatableBool(expr as unknown as SerializedNode<BoolVal>);
        case 'IntVal':
            return signedInt(expr as unknown as SerializedNode<IntVal>);
        case 'StringVal': {
            const e = expr as unknown as SerializedNode<StringVal>;
            return e.val;
        }
        case 'EnumValueRef': {
            // Enum reference evaluates to its value name (parallel to the backend
            // interpreter and dnd-dsl-value-evaluator).
            if (!options?.worldState) return undefined;
            const ref = (expr as unknown as { value: { $ref: string } }).value;
            const decl = parseReferenceFromSerializedModel<SerializedEnumValueDecl>(options.worldState, ref);
            return decl?.name;
        }
        case 'IntExpression': {
            const e = expr as SerializedNode<IntExpression>;
            return applyArithmetic(e.operator as ArithmeticOperator, evaluateExpression(e.left, options), evaluateExpression(e.right, options));
        }
        case 'BoolExpression': {
            const e = expr as SerializedNode<BoolExpression>;
            return applyLogical(e.operator as LogicalOperator, evaluateExpression(e.left, options), () => evaluateExpression(e.right, options));
        }
        case 'IntToBoolExpression': {
            const e = expr as SerializedNode<IntToBoolExpression>;
            return applyComparison(e.operator as ComparisonOperator, evaluateExpression(e.left, options), evaluateExpression(e.right, options), e.negated);
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
            if (!options?.worldState) return undefined;
            try {
                const target = resolveSerializedRefChain(options.worldState, expr as unknown as SerializedRefChain);
                if (target.kind === 'location' || target.kind === 'entity') {
                    // Reuse the ObjectDeclaration case above rather than duplicating record-building.
                    return evaluateExpression({ $type: 'ObjectDeclaration', variables: target.node.variables } as any, options);
                }
                return evaluateExpression(target.node.value, { variableName: target.node.target, worldState: options.worldState });
            } catch {
                // Unresolved/unsupported chain (e.g. an event head - not implemented yet).
                // This function runs eagerly during render (LocationView), so a throw here
                // would crash the page - treat it like any other unresolvable expression.
                return undefined;
            }
        }
    }

    // FunctionCall, RefChain, EventCalledExpression, quest/objective expressions etc.
    // can't be resolved without runtime state - caller decides how to display these
    return undefined;
}
