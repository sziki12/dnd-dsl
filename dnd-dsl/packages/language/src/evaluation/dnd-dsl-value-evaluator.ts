import type {
    SerializedExpression,
    SerializedLocation,
    SerializedModel,
    SerializedNpc,
    SerializedQuest,
    SerializedVariableDecl,
    SerializedRefChain,
} from './dnd-dsl-serialized-types.js';
import { parseReferenceFromSerializedModel } from './dnd-dsl-reference.js';

// This file operates entirely on the JSON-serialized model - no Langium LSP-only
// services are touched - so it's safe to import from both the Node.js backend and the
// browser frontend, same as dnd-dsl-reference.ts / dnd-dsl-state-path.ts.

export type JsonRuntimeValue =
    | number
    | boolean
    | string
    | undefined
    | { [key: string]: JsonRuntimeValue };

export type RefChainTarget =
    | { kind: 'location'; node: SerializedLocation }
    | { kind: 'entity'; node: SerializedNpc | SerializedQuest }
    | { kind: 'variable'; node: SerializedVariableDecl };

/**
 * Resolves a JSON-serialized RefChain to the exact node it addresses, without
 * evaluating it - callers decide how to turn the result into a value. No StatePath
 * bridging is needed here: `$ref` strings are produced by Langium's own serializer from
 * an already-linked AST (post DndScopeProvider's member-access fix), so they already
 * encode the full resolved path, regardless of Location/ObjectDeclaration nesting depth.
 *
 * Quest/Event heads throw - synthetic members (status/fired) aren't backed by any
 * runtime state yet; deferred, not this MVP's scope.
 */
export function resolveSerializedRefChain(model: SerializedModel, chain: SerializedRefChain): RefChainTarget {
    const first = chain.first as { $type: string };

    if (first.$type === 'EventRefItem') {
        throw new Error(`RefChain heads of kind '${first.$type}' are not supported yet`);
    }

    if (first.$type === 'LocationRefItem' && chain.rest.length === 0) {
        const ref = (first as unknown as { val: { val: { $ref: string } } }).val.val;
        const loc = parseReferenceFromSerializedModel<SerializedLocation>(model, ref);
        if (!loc) throw new Error(`Unresolved location ref: ${ref.$ref}`);
        return { kind: 'location', node: loc };
    }

    if ((first.$type === 'QuestRefItem' || first.$type === 'NpcRefItem') && chain.rest.length === 0) {
        const ref = (first as unknown as { val: { val: { $ref: string } } }).val.val;
        const node = parseReferenceFromSerializedModel<SerializedNpc | SerializedQuest>(model, ref);
        if (!node) throw new Error(`Unresolved entity ref: ${ref.$ref}`);
        return { kind: 'entity', node };
    }

    // Every remaining shape ends in a VariableRefItem - either chain.first itself (a
    // bare or entity-qualified-with-rest variable chain) or the last chain.rest item.
    const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chain.first;
    const ref = (tail as unknown as { val: { val: { $ref: string } } }).val.val;
    const decl = parseReferenceFromSerializedModel<SerializedVariableDecl>(model, ref);
    if (!decl) throw new Error(`Unresolved variable ref in chain: ${ref.$ref}`);
    return { kind: 'variable', node: decl };
}

/**
 * Builds the plain-record representation of an object's/location's members - the same
 * `{ [target]: value }` shape LangiumInterpreterService.evaluateExpression already
 * produces for an ObjectDeclaration, so property access is uniform regardless of
 * whether a value originated from local scope or persistent (overlay-applied) state.
 */
export function buildVariablesRecord(model: SerializedModel, variables: SerializedVariableDecl[]): Record<string, JsonRuntimeValue> {
    return variables.reduce<Record<string, JsonRuntimeValue>>((rec, v) => {
        rec[v.target ?? v.name ?? ''] = evaluateSerializedExpression(model, v.value);
        return rec;
    }, {});
}

/**
 * JSON-native counterpart to LangiumInterpreterService.evaluateExpression, for reading
 * live (overlay-applied) values out of a served worldState.
 *
 * MUST short-circuit on a raw (non-`$type`-tagged) value first: an ASSIGN_VARIABLE
 * overlay write replaces a leaf VariableDeclaration.value with a bare JS primitive, no
 * `$type` at all (see WorldStateService.spliceOverlayValue) - without this check, every
 * overlaid leaf would silently evaluate to `undefined`.
 *
 * FunctionCall / EventCalledExpression / Quest*Expression / ObjectiveExpressions return
 * `undefined` - running call/quest semantics against JSON isn't implemented (mirrors the
 * frontend evaluator's pre-existing FunctionCall stub); out of scope here.
 */
export function evaluateSerializedExpression(model: SerializedModel, expr: unknown): JsonRuntimeValue {
    if (expr === undefined || expr === null) return undefined;
    if (typeof expr !== 'object') return expr as JsonRuntimeValue;

    const node = expr as SerializedExpression & { $type: string };

    switch (node.$type) {
        case 'IntVal': {
            const v = node as unknown as { isNegative?: boolean; val: number };
            return v.isNegative ? -v.val : v.val;
        }
        case 'BoolVal': {
            const v = node as unknown as { isNegated?: boolean; val: boolean };
            return v.isNegated ? !v.val : v.val;
        }
        case 'StringVal':
            return (node as unknown as { val: string }).val;

        case 'Expression':
        case 'GroupedExpression':
            return evaluateSerializedExpression(model, (node as unknown as { exp: unknown }).exp);

        case 'IntExpression': {
            const e = node as unknown as { left: unknown; operator: '+' | '-' | '*' | '/'; right: unknown };
            const l = evaluateSerializedExpression(model, e.left);
            const r = evaluateSerializedExpression(model, e.right);
            if (typeof l !== 'number' || typeof r !== 'number') return undefined;
            switch (e.operator) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return r !== 0 ? l / r : undefined;
            }
            return undefined;
        }

        case 'BoolExpression': {
            const e = node as unknown as { left: unknown; operator: 'and' | 'or'; right: unknown };
            const l = evaluateSerializedExpression(model, e.left);
            if (e.operator === 'and') return Boolean(l) && Boolean(evaluateSerializedExpression(model, e.right));
            if (e.operator === 'or') return Boolean(l) || Boolean(evaluateSerializedExpression(model, e.right));
            return undefined;
        }

        case 'IntToBoolExpression': {
            const e = node as unknown as { left: unknown; operator: '==' | '!=' | '<' | '>' | '<=' | '>=' | 'is'; right: unknown; negated?: boolean };
            const l = evaluateSerializedExpression(model, e.left);
            const r = evaluateSerializedExpression(model, e.right);
            switch (e.operator) {
                case '==': return l === r;
                case '!=': return l !== r;
                case 'is': { const eq = l === r; return e.negated ? !eq : eq; }
            }
            if (typeof l !== 'number' || typeof r !== 'number') return undefined;
            switch (e.operator) {
                case '<': return l < r;
                case '>': return l > r;
                case '<=': return l <= r;
                case '>=': return l >= r;
            }
            return undefined;
        }

        case 'ObjectDeclaration':
            return buildVariablesRecord(model, (node as unknown as { variables: SerializedVariableDecl[] }).variables);

        case 'RefChain': {
            const target = resolveSerializedRefChain(model, node as unknown as SerializedRefChain);
            return target.kind === 'location' || target.kind === 'entity'
                ? buildVariablesRecord(model, target.node.variables)
                : evaluateSerializedExpression(model, target.node.value);
        }

        default:
            return undefined;
    }
}
