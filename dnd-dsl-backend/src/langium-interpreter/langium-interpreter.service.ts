import { randomUUID } from 'crypto';
import type { AstNode } from 'langium';
import {
    ChangeOccurrence,
    Code,
    CodeBlock,
    ChainTail,
    ConditionalBlock,
    ConstantExpression,
    EnumValueDecl,
    Expression,
    ForStatement,
    FunctionCall,
    FunctionDeclaration,
    isBoolExpression,
    isBoolVal,
    isConstantExpression,
    isEnumRefItem,
    isEnumValueRef,
    isEvent,
    isEventRefItem,
    isFunctionCall,
    isGroupedExpression,
    isIntExpression,
    isIntToBoolExpression,
    isIntVal,
    isListLiteral,
    isLocation,
    isLocationRefItem,
    isFaction,
    isFactionRefItem,
    isRelation,
    isRelationRefItem,
    isNpc,
    isNpcRefItem,
    isObjectDeclaration,
    isObjective,
    isObjectiveRefItem,
    isParentRefItem,
    isQuest,
    isQuestExpressions,
    isQuestRef,
    isQuestRefItem,
    isRefChain,
    isReferenceExpression,
    isStringVal,
    isThisRefItem,
    isVariableRefItem,
    isWorld,
    isWorldRefItem,
    LocationExit,
    Model,
    Objective,
    OnBlock,
    RelationRefItem,
    PrintStatement,
    Quest,
    QuestStatements,
    RefChain,
    ReferenceExpression,
    RemindStatement,
    ReturnStatement,
    SetStatement,
    VariableDeclaration,
} from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';
import { predefinedFunctionsAsMap } from '../predefined/predefined-functions';
import { ENDPOINT_KIND, findRelation } from '@dnd-language/evaluation/dnd-dsl-relations.js';
import { chainHead, encodeStatePath, nodeToStatePath, parentOwningObject, statePathToNode, unwrapExpression, type ChainHead, type OwningObject, type StatePath } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import { getPredefinedSignature } from '@dnd-language/evaluation/dnd-dsl-predefined-signatures.js';
import { buildVariablesRecord, evaluateSerializedExpression } from '@dnd-language/evaluation/dnd-dsl-value-evaluator.js';
import type { SerializedModel } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { durationToRounds } from '@dnd-language/evaluation/dnd-dsl-clock.js';
import { applyArithmetic, applyComparison, applyIndex, applyLogical, NAMED_COLLECTION_FIELDS, negatableBool, replaceAtIndexes, signedInt } from '@dnd-language/evaluation/dnd-dsl-expression-operations.js';
import { computeRemindBodyLocator, type FiredReminder, type ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';
import { assertValidStatusWrite, objectiveStatusPath, questStatusPath, STATUS_VARIABLE, statusBlockFor, statusExpressionHolds, statusOrDefault, statusTransition, type StatusAction, type StatusBlock, type StatusKind } from '@dnd-language/evaluation/dnd-dsl-status.js';

type RuntimeScope = Record<string, any>;

/** How many handler / quest-block frames may nest before it is treated as a loop. */
const MAX_CASCADE_DEPTH = 50;

/** 
 * A `print` or a persistent write, recorded in `EvalContext.events` in the order it ran
 **/
export type InterpreterEvent =
    | { kind: 'print'; value: unknown; depth: number }
    | { kind: 'write'; path: StatePath; value: unknown; depth: number }
    | { kind: 'trigger'; eventName: string; depth: number }
    | { kind: 'handler'; label: string; depth: number };

/**
 * `worldState` is the current, overlay-applied JSON world state (WorldStateService.getWorldState()), used to resolve persistent RefChain-s
 * `scope` is the local/function runtime scope
 * `clock`/`reminders` back RemindStatement scheduling
 * `model` is the loaded live AST
 * `pendingOverlayWrites` collects entity-variable
 *  writes from `set` / assignment for the caller to flush
 * `triggeredEvents` guards against `trigger` recursion
 * `firedReminders` collects `remind` statements with no `after` clause, which fire the instant they run rather than entering the time queue
 * `events` collects `print`s and writes, in execution order, for the caller to surface.
 */
export type EvalContext = {
    scope: RuntimeScope;
    worldState: SerializedModel;
    clock: number;
    reminders: ScheduledReminder[];
    model?: Model;
    pendingOverlayWrites?: { path: StatePath; value: unknown }[];
    triggeredEvents?: Set<string>;
    firedReminders?: FiredReminder[];
    events?: InterpreterEvent[];
    changeHandlers?: Map<string, OnBlock[]>;
    triggerHandlers?: Map<string, OnBlock[]>;
    firedHandlers?: Set<OnBlock>;
    handlerDepth?: number;
    thisEntity?: OwningObject;
    parentEntity?: OwningObject;
};

class ReturnSignal {
    constructor(public readonly value: any) {}
}

/**
 * What a `for x in <collection> do ... end` loop variable is bound to for one
 * ENTITY-collection element (npc/location/quest/objective/sublocation - anything with
 * its own `.variables`). Deliberately just a StatePath, not a live AST node reference:
 * the element is a real, normally-positioned node, so `nodeToStatePath` on it already
 * produces the correct persistent address - no new addressing scheme needed, and no
 * circular AST reference ends up in `ctx.scope`/`ctx.events` (which would break
 * `print x` - the frontend JSON.stringifies printed values). `x.member`'s member name
 * is read from the reference's raw `$refText`, never `.ref` - see
 * DndScopeProvider.getMemberScope's loop-variable branch, which links `.member` to a
 * permissive placeholder that carries no real information beyond letting the
 * reference resolve at all.
 */
type LoopEntityHandle = { readonly __loopEntity: true; readonly path: StatePath };

function isLoopEntityHandle(value: unknown): value is LoopEntityHandle {
    return typeof value === 'object' && value !== null && (value as { __loopEntity?: unknown }).__loopEntity === true;
}

@Injectable()
export class LangiumInterpreterService {

    evaluateExpression(ctx: EvalContext, expression: Expression): any {
        if(isConstantExpression(expression)){
            return this.evaluateConstantExpression(ctx, expression);
        }

        if(isReferenceExpression(expression)){
            return this.evaluateReferenceExpression(ctx, expression);
        }

        if (isEnumValueRef(expression)) {
            // Runtime value of an enum reference is its value name 
            // Keeps comparison as plain string comparison
            return expression.value.ref?.name ?? expression.value.$refText;
        }
        
        if (isGroupedExpression(expression)) {
            return this.evaluateExpression(ctx, expression.exp);
        }
        if (isIntExpression(expression)) {
            return applyArithmetic(
                expression.operator,
                this.evaluateExpression(ctx, expression.left),
                this.evaluateExpression(ctx, expression.right),
            );
        }
        if (isIntToBoolExpression(expression)) {
            return applyComparison(
                expression.operator,
                this.evaluateExpression(ctx, expression.left),
                this.evaluateExpression(ctx, expression.right),
                expression.negated,
            );
        }
        if (isBoolExpression(expression)) {
            return applyLogical(
                expression.operator,
                this.evaluateExpression(ctx, expression.left),
                () => this.evaluateExpression(ctx, expression.right),
            );
        }

        if(expression.$type === 'Expression'){
            return this.evaluateExpression(ctx, expression.exp);
        }

        throw new Error(`Unhandled expression type: ${expression.$type}`);
    }

    /** 
     *  Resolves a RefChain to its StatePath using only its own AST structure, no EvalContext needed.
     *  Everything resolveRefChainToStatePath does except the for-loop-bound-entity runtime fallback, 
     *  which a declaration-time target (an OnClause's, resolved once when the handler index is built) can never hit.
     *  It's never inside a for loops body. 
     **/
    resolveStaticRefChainToStatePath(chain: RefChain): StatePath {
        const head = chainHead(chain);
        if (isEventRefItem(head)) {
            throw new Error(`Cannot resolve a '${head.$type}' reference to a StatePath`);
        }
        if (chain.rest.length === 0
            && (isLocationRefItem(head) || isQuestRefItem(head) || isObjectiveRefItem(head) || isNpcRefItem(head) || isFactionRefItem(head))) {
            const node = head.val.val.ref;
            if (!node) throw new Error(`Unresolved ref: ${head.val.val.$refText}`);
            return nodeToStatePath(node)!;
        }

        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : head;
        if (!isVariableRefItem(tail)) throw new Error(`Unsupported target: ${tail.$type}`);
        const decl = tail.val.val.ref;
        if (!decl) throw new Error(`Unresolved variable ref: ${tail.val.val.$refText}`);
        const path = nodeToStatePath(decl);
        if (!path) throw new Error(`Cannot resolve a local/non-persistent variable to a StatePath`);
        return path;
    }

    private evaluateReferenceExpression(ctx: EvalContext, expression: ReferenceExpression): any {
        if (isFunctionCall(expression)) {
            return this.executeFunctionCall(ctx, expression);
        }
        if (isRefChain(expression)) {
            return this.evaluateRefChain(ctx, expression);
        }
        if (isQuestExpressions(expression)) {
            const entity = expression.target.val.ref;
            if (!entity) throw new Error(`Unresolved quest/objective ref: ${expression.target.val.$refText}`);
            return statusExpressionHolds(expression.$type, this.statusOf(ctx, entity));
        }
    /*
        TODO LocationChain
        if (isLocationChain(expression)) {
            return this.evaluateLocationChain(ctx, expression);
        }

        TODO EventCalledExpression
        if (isEventCalledExpression(expression)) {
            return this.evaluateEventCalledExpression(ctx, expression);
        } 
    */
        throw new Error(`Unhandled reference expression type: ${expression}`);
    }

    private evaluateConstantExpression(ctx: EvalContext, expression: ConstantExpression): any {
        if (isIntVal(expression)) {
            return signedInt(expression);
        }
        if (isBoolVal(expression)) {
            return negatableBool(expression);
        }
        if (isStringVal(expression)) {
            return expression.val;
        }
        if (isListLiteral(expression)) {
            return expression.elements.map(element => this.evaluateExpression(ctx, element));
        }
        if (isObjectDeclaration(expression)) {
            return expression.variables.reduce((obj: RuntimeScope, v) => {
                const name = v.target ?? v.name ?? '';
                obj[name] = v.value ? this.evaluateExpression(ctx, v.value) : undefined;
                return obj;
            }, {});
        }

        throw new Error(`Unhandled constant expression type: ${expression}`);

    }

    /** The chain's value: its first segment, then each segment that follows an index. */
    private evaluateRefChain(ctx: EvalContext, chain: RefChain): any {
        let value = this.evaluateFirstSegment(ctx, chain);
        for (let tail = chain.next; tail; tail = tail.next) value = this.evaluateTail(ctx, value, tail);
        // A bare entity item (`quest "Q" . objectives[0]`) reads as that entity's variables, as `quest "Q"` does.
        return isLoopEntityHandle(value) ? this.readPath(ctx, value.path) : value;
    }

    /** The head, members and field, then the indexes that follow them. */
    private evaluateFirstSegment(ctx: EvalContext, chain: RefChain): unknown {
        return this.applyIndexes(ctx, this.evaluateRefChainBase(ctx, chain), chain.indexes, chain.field);
    }

    /** One segment after an index: members read off the item, a field of it, then more indexes. */
    private evaluateTail(ctx: EvalContext, item: unknown, tail: ChainTail): unknown {
        const field: string | undefined = tail.field;
        let value = item;
        if (tail.rest.length > 0) value = this.readMembers(ctx, value, tail.rest.map(member => member.val.val.$refText));
        if (field) value = this.readField(ctx, value, field);
        return this.applyIndexes(ctx, value, tail.indexes, field);
    }

    /** `.a . b` off an item: an entity's variables by their address, or a plain record's properties. */
    private readMembers(ctx: EvalContext, item: unknown, names: string[]): unknown {
        if (isLoopEntityHandle(item)) {
            const path: StatePath = [...item.path, ...names.map(target => ({ kind: 'variable' as const, target }))];
            const value = this.readPath(ctx, path);
            if (value === undefined && !statePathToNode(ctx.worldState as unknown as Model, path)) {
                throw new Error(`'${names.join('.')}' is not a variable of ${this.describeEntity(item)}.`);
            }
            return value;
        }
        let current = item;
        for (const name of names) {
            if (typeof current !== 'object' || current === null) {
                throw new Error(`Cannot read '.${name}' of ${this.describeItem(current)}.`);
            }
            current = (current as Record<string, unknown>)[name];
        }
        return current;
    }

    /** `. field` off an entity item (`.name`, `.objectives`, ...). */
    private readField(ctx: EvalContext, item: unknown, field: string): unknown {
        if (!isLoopEntityHandle(item)) throw new Error(`'.${field}' can only be read off an entity, not ${this.describeItem(item)}.`);
        const node = ctx.model ? statePathToNode(ctx.model, item.path) : undefined;
        if (!node) throw new Error(`Cannot find ${this.describeEntity(item)} to read '.${field}' from.`);
        return this.fieldValueOf(ctx, node as AstNode, field);
    }

    /** Each `[index]` in turn. Only the first can follow a collection field, so only it may pick by name. */
    private applyIndexes(ctx: EvalContext, value: unknown, indexes: Expression[], field?: string): unknown {
        let current = value;
        indexes.forEach((expression, position) => {
            current = this.indexInto(current, this.evaluateExpression(ctx, expression), position === 0 ? field : undefined);
        });
        return current;
    }

    private indexInto(list: unknown, index: unknown, field: string | undefined): unknown {
        if (typeof index === 'string' && field && NAMED_COLLECTION_FIELDS.has(field)) {
            return this.itemByName(list, index, field);
        }
        return applyIndex(list, index);
    }

    /** A missing name is nearly always a typo, so unlike a position past the end it is an error, not nothing. */
    private itemByName(items: unknown, name: string, field: string): unknown {
        if (!Array.isArray(items)) throw new Error(`Only a collection can be indexed by name, not ${this.describeItem(items)}.`);
        const found = items.find(item => this.itemName(item) === name);
        if (found === undefined) {
            const available = items.map(item => this.itemName(item)).filter((n): n is string => n !== undefined);
            throw new Error(`There is no item named "${name}" in '.${field}'. Available: ${available.length > 0 ? available.join(', ') : '(none)'}.`);
        }
        return found;
    }

    private itemName(item: unknown): string | undefined {
        if (typeof item === 'string') return item;
        if (isLoopEntityHandle(item)) {
            const last = item.path[item.path.length - 1];
            return last && 'name' in last ? last.name : undefined;
        }
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === 'string' ? name : undefined;
    }

    private describeEntity(handle: LoopEntityHandle): string {
        const last = handle.path[handle.path.length - 1];
        return last && 'name' in last ? `${last.kind} "${last.name}"` : 'that entity';
    }

    private describeItem(value: unknown): string {
        if (value === undefined || value === null) return 'nothing';
        return typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'a record' : String(value);
    }

    private evaluateRefChainBase(ctx: EvalContext, chain: RefChain): any {
        const head = chainHead(chain);
        if (chain.field) 
            return this.resolveFieldValue(ctx, chain);

        if (isEventRefItem(head)) {
            //TODO EventRefItem
            throw new Error(`RefChain heads of kind '${head.$type}' are not supported yet`);
        }

        if (chain.rest.length === 0) {
            if (isLocationRefItem(head)) {
                const loc = head.val.val.ref;
                if (!loc) throw new Error(`Unresolved location ref: ${head.val.val.$refText}`);
                return this.readPath(ctx, [{ kind: 'location', name: loc.name }]);
            }
            if (isQuestRefItem(head)) {
                const q = head.val.val.ref;
                if (!q) throw new Error(`Unresolved quest ref: ${head.val.val.$refText}`);
                return this.readPath(ctx, [{ kind: 'quest', name: q.name }]);
            }
            if (isObjectiveRefItem(head)) {
                const o = head.val.val.ref;
                if (!o) throw new Error(`Unresolved objective ref: ${head.val.val.$refText}`);
                return this.readPath(ctx, nodeToStatePath(o)!);
            }
            if (isNpcRefItem(head)) {
                const n = head.val.val.ref;
                if (!n) throw new Error(`Unresolved npc ref: ${head.val.val.$refText}`);
                return this.readPath(ctx, [{ kind: 'npc', name: n.name }]);
            }
            if (isFactionRefItem(head)) {
                const f = head.val.val.ref;
                if (!f) throw new Error(`Unresolved faction ref: ${head.val.val.$refText}`);
                return this.readPath(ctx, [{ kind: 'faction', name: f.name }]);
            }
            if (isRelationRefItem(head)) return this.relationExists(ctx, head);
            if (isThisRefItem(head)) {
                if (!ctx.thisEntity) throw new Error(`'this' is not available here`);
                if (isEvent(ctx.thisEntity)) throw new Error(`Cannot read 'this' as a value when it refers to an Event`);
                const path = nodeToStatePath(ctx.thisEntity);
                if (!path) throw new Error(`'this' has no persistent address here`);
                return this.readPath(ctx, path);
            }
            if (isParentRefItem(head)) {
                if (!ctx.parentEntity) throw new Error(`'parent' is not available here`);
                if (isEvent(ctx.parentEntity)) throw new Error(`Cannot read 'parent' as a value when it refers to an Event`);
                const path = nodeToStatePath(ctx.parentEntity);
                if (!path) throw new Error(`'parent' has no persistent address here`);
                return this.readPath(ctx, path);
            }
        }

        // Every remaining shape ends in a VariableRefItem - either head itself
        // (a bare or location-qualified-with-rest variable chain) or the last chain.rest
        // item. Once scoping links each segment directly to its target, no per-segment
        // key-walk is needed for the persistent case - nodeToStatePath on the tail alone
        // recovers the full path back to the syntactic root.
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : head;
        if (!isVariableRefItem(tail)) {
            throw new Error(`Unsupported RefChain tail: ${tail.$type}`);
        }
        const decl = tail.val.val.ref;
        if (!decl) throw new Error(`Unresolved variable ref in chain: ${tail.val.val.$refText}`);

        // A loop variable's member links to a placeholder, not a declaration: walking up from it would end at the
        // enclosing event and read that, so it is read through the loop variable's own value below.
        const path = (decl.$type as string) === 'DynamicMember' ? undefined : nodeToStatePath(decl);
        if (path) return this.readPath(ctx, path);

        // Local/function-scoped - nodeToStatePath only returns a path for a
        // Location-rooted declaration, so head can't be a LocationRefItem here;
        // it must itself be a VariableRefItem. No StatePath bridge exists for it - walk
        // ctx.scope by name instead.
        if (!isVariableRefItem(head)) {
            throw new Error(`Unsupported RefChain head: ${head.$type}`);
        }
        const headDecl = head.val.val.ref;
        if (!headDecl) throw new Error(`Unresolved variable ref: ${head.val.val.$refText}`);
        const headValue = ctx.scope[headDecl.target ?? headDecl.name ?? ''];

        // A for-loop-bound entity (see LoopEntityHandle) - read through its real
        // persistent StatePath, not by walking ctx.scope as a plain object. Only one
        // level of member access is supported (chain.rest[0]) - a loop variable's
        // member access links to a permissive placeholder (see the scope provider),
        // so a second dot (`x.a.b`) fails to link before this code ever runs.
        if (isLoopEntityHandle(headValue)) {
            if (chain.rest.length === 0) return this.readPath(ctx, headValue.path);
            const tailName = chain.rest[0].val.val.$refText;
            return this.readPath(ctx, [...headValue.path, { kind: 'variable', target: tailName }]);
        }

        let current: any = headValue;
        for (const item of chain.rest) {
            const d = item.val.val.ref;
            if (!d) throw new Error(`Unresolved variable ref in chain: ${item.val.val.$refText}`);
            const name = (d.$type as string) === 'DynamicMember' ? item.val.val.$refText : (d.target ?? d.name ?? '');
            current = current?.[name];
        }
        return current;
    }

    /** Whether the fact a `relation ...` head names is written in the world. Facts are source, so the live model answers. */
    private relationExists(ctx: EvalContext, head: RelationRefItem): boolean {
        const host = head.subject.val.val.ref;
        const target = head.target.val.val.ref;
        const type = head.predicate.ref;
        if (!host) throw new Error(`Unresolved ref: ${head.subject.val.val.$refText}`);
        if (!target) throw new Error(`Unresolved ref: ${head.target.val.val.$refText}`);
        if (!type) throw new Error(`Unresolved relation type: ${head.predicate.$refText}`);
        return findRelation(ctx.model, host, type.name, ENDPOINT_KIND[head.target.$type], target.name) !== undefined;
    }

    /** A persistent read that sees this run's own not-yet-flushed writes: the newest
     *  pending write to exactly this path wins, else the served state is read. Without
     *  it a second `append` on a persistent list would start from the old value and
     *  lose the first. An entity read as a whole (`print quest "Q"`) is the served record
     *  with every pending write to one of its variables laid over it, in order. */
    private readPath(ctx: EvalContext, path: StatePath): any {
        const pending = ctx.pendingOverlayWrites;
        if (pending?.length) {
            const key = encodeStatePath(path);
            for (let i = pending.length - 1; i >= 0; i--) {
                if (encodeStatePath(pending[i].path) === key) return structuredClone(pending[i].value);
            }
        }
        const value = this.readPersistentValue(ctx.worldState, path);
        const isEntity = path[path.length - 1]?.kind !== 'variable';
        if (!pending?.length || !isEntity || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
        return this.overlayPendingOnto(structuredClone(value), path, pending);
    }

    /** Lays the pending writes under `entityPath` onto a copy of that entity's variables record. */
    private overlayPendingOnto(record: Record<string, any>, entityPath: StatePath, pending: { path: StatePath; value: unknown }[]): Record<string, any> {
        const prefix = encodeStatePath(entityPath);
        for (const write of pending) {
            if (write.path.length <= entityPath.length || encodeStatePath(write.path.slice(0, entityPath.length)) !== prefix) continue;
            const rest = write.path.slice(entityPath.length);
            if (!rest.every(segment => segment.kind === 'variable')) continue;
            const keys = rest.map(segment => (segment as { target: string }).target);
            let holder: any = record;
            for (const key of keys.slice(0, -1)) {
                holder = holder?.[key];
                if (holder === null || typeof holder !== 'object') { holder = undefined; break; }
            }
            if (holder) holder[keys[keys.length - 1]] = structuredClone(write.value);
        }
        return record;
    }

    /** Reads the current (overlay-applied) value a persistent StatePath addresses, from
     *  the served worldState JSON - never the live AST, whose VariableDeclaration.value
     *  nodes are never touched post-parse (see WorldStateService.spliceOverlayValue). */
    private readPersistentValue(worldState: SerializedModel, path: StatePath): any {
        const node = statePathToNode(worldState as unknown as Model, path) as any;
        if (!node) return undefined; // renamed/removed since linking - soft-fail
        if (isLocation(node) || isObjectDeclaration(node) || isNpc(node) || isFaction(node) || isRelation(node) || isQuest(node) || isObjective(node) || isWorld(node)) {
            return buildVariablesRecord(worldState, node.variables as any);
        }
        return evaluateSerializedExpression(worldState, node.value);
    }

    executeFunctionCall(ctx: EvalContext, call: FunctionCall): any {
        const args = call.params.map(p => this.evaluateExpression(ctx, p));

        if (call.predefined) {
            const fn = predefinedFunctionsAsMap[call.predefinedTarget!];
            if (!fn) throw new Error(`Unknown predefined function: ${call.predefinedTarget}`);
            return fn(...args);
        }

        const decl = call.target?.val.ref;
        if (!decl) throw new Error(`Unresolved function ref: ${call.target?.val.$refText}`);
        return this.callFunctionDecl(ctx, decl, args);
    }

    triggerEventByName(model: Model, eventName: string, ctx: EvalContext) {
        const eventDecl = model.World.events.find(e => e.name === eventName);
        if (!eventDecl) throw new Error(`Event '${eventName}' not found`);
        if(!eventDecl.codeBlock) return;
        this.runCodeBlock(ctx, eventDecl.codeBlock);
    }

    /**
     * Look up a function by name in the parsed model and execute it.
     * Returns the function's return value, or undefined if the function has no return statement.
     */
    callFunctionByName(model: Model, functionName: string, args: any[], ctx: EvalContext): any {
        let decl = model.World.functions.find(f => f.name === functionName);
        if(!decl) {
            console.log("Calling predefined function:", functionName, args);
            const predefined = predefinedFunctionsAsMap[functionName];
            if (!predefined) throw new Error(`Function '${functionName}' not found`);

            const result = predefined(...args);
            console.log(`Function '${functionName}' returned:`, result);
            return result;
        }
        if (!decl) throw new Error(`Function '${functionName}' not found`);
        console.log("Calling function:", functionName, args);
        return this.callFunctionDecl(ctx, decl, args);
    }

    private callFunctionDecl(callerCtx: EvalContext, decl: FunctionDeclaration, args: any[]): any {
         const localCtx: EvalContext = {
            scope: Object.create(callerCtx.scope),
            worldState: callerCtx.worldState,
            clock: callerCtx.clock,
            reminders: callerCtx.reminders,
            model: callerCtx.model,
            pendingOverlayWrites: callerCtx.pendingOverlayWrites,
            triggeredEvents: callerCtx.triggeredEvents,
            firedReminders: callerCtx.firedReminders,
            events: callerCtx.events,
            changeHandlers: callerCtx.changeHandlers,
            triggerHandlers: callerCtx.triggerHandlers,
            firedHandlers: callerCtx.firedHandlers,
            handlerDepth: callerCtx.handlerDepth,
            thisEntity: callerCtx.thisEntity,
            parentEntity: callerCtx.parentEntity,
        };

        decl.params.forEach((param, i) => {
            const name = param.name ?? param.target ?? '';
            localCtx.scope[name] = args[i];
        });

        if (!decl.codeBlock) return undefined;

        const result = this.runCodeBlock(localCtx, decl.codeBlock);
        console.log(`Function '${decl.name}' returned:`, result instanceof ReturnSignal ? result.value : undefined);
        return result instanceof ReturnSignal ? result.value : undefined;
    }

    runCodeBlock(ctx: EvalContext, codeBlock: CodeBlock): ReturnSignal | undefined {
        for (const code of codeBlock.code) {
            const result = this.runCode(ctx, code);
            if (result instanceof ReturnSignal) return result;
        }
        return undefined;
    }

    /** 
     *  Runs a script body and returns its `return` value (or undefined). 
     *  Entity writes land in `ctx.pendingOverlayWrites` for the caller to flush. 
     **/
    runScript(ctx: EvalContext, codeBlock: CodeBlock): unknown {
        const result = this.runCodeBlock(ctx, codeBlock);
        return result instanceof ReturnSignal ? result.value : undefined;
    }

    runCode(ctx: EvalContext, code: Code): ReturnSignal | undefined {
        switch (code.$type) {
            case 'VariableDeclaration': {
                const c = code as VariableDeclaration;
                const name = c.target ?? '';
                ctx.scope[name] = c.value ? this.evaluateExpression(ctx, c.value) : undefined;
                break;
            }
            case 'VariableAssignment': {
                const decl = code.target.val.ref;
                const value = this.evaluateExpression(ctx, code.value);
                // An assignment whose target is an entity-owned variable (a name-based
                // StatePath resolves) is a persistent write; anything else is a
                // local/function-scope write.
                const path = decl ? nodeToStatePath(decl) : undefined;
                if (path && ctx.pendingOverlayWrites) {
                    this.pushWrite(ctx, path, value);
                } else {
                    ctx.scope[decl?.target ?? decl?.name ?? ''] = value;
                }
                break;
            }
            case 'SetStatement': {
                const c = code as unknown as SetStatement;
                const value = this.evaluateExpression(ctx, c.value);
                const { path, indexes } = this.resolveSetTarget(ctx, c.target);
                if (path[path.length - 1]?.kind !== 'variable') {
                    throw new Error('`set` needs an entity variable target, e.g. `set npc "X" . mood = ...`');
                }
                if (indexes.length > 0) {
                    this.pushWrite(ctx, path, replaceAtIndexes(this.readPath(ctx, path), indexes, value));
                    break;
                }
                const statusOwner = this.statusOwner(ctx, path);
                if (statusOwner) this.setStatus(ctx, statusOwner, value);
                else this.pushWrite(ctx, path, value);
                break;
            }
            case 'FunctionCall': {
                const c = code as unknown as FunctionCall;
                const result = this.executeFunctionCall(ctx, c);
                this.writeBackIfRequested(ctx, c, result);
                break;
            }
            case 'ReturnStatement': {
                const c = code as unknown as ReturnStatement;
                const value = c.returnValue ? this.evaluateExpression(ctx, c.returnValue) : undefined;
                return new ReturnSignal(value);
            }
            case 'PrintStatement': {
                const c = code as unknown as PrintStatement;
                const value = this.evaluateExpression(ctx, c.value);
                console.log('[script print]', value);
                ctx.events?.push({ kind: 'print', value, depth: this.cascadeDepth(ctx) });
                break;
            }
            case 'ConditionalBlock': {
                const c = code as unknown as ConditionalBlock;
                const condition = this.evaluateExpression(ctx, c.condition);
                for (const block of condition ? c.body : c.otherwise) {
                    const result = this.runCodeBlock(ctx, block);
                    if (result instanceof ReturnSignal) return result;
                }
                break;
            }
            case 'EventTrigger': {
                const name = code.target.val.ref?.name;
                if (!name || !ctx.model) break;
                const seen = (ctx.triggeredEvents ??= new Set());
                // re-entrancy guard
                if (seen.has(name)) break;
                seen.add(name);
                ctx.events?.push({ kind: 'trigger', eventName: name, depth: this.cascadeDepth(ctx) });
                try {
                    this.triggerEventByName(ctx.model, name, ctx);
                    this.dispatchTriggerHandlers(ctx, name);
                } finally {
                    seen.delete(name);
                }
                break;
            }
            case 'QuestStatements': {
                const stmt = code as unknown as QuestStatements;
                const entity = stmt.target.val.ref;
                if (!entity) throw new Error(`Unresolved ${isQuestRef(stmt.target) ? 'quest' : 'objective'} ref: ${stmt.target.val.$refText}`);
                this.applyStatusAction(ctx, entity, stmt.status);
                break;
            }
            case 'ForStatement': {
                const c = code as unknown as ForStatement;
                const loopVarName = c.loopVar.name ?? '';
                const values = this.iterationValues(ctx, c.source);
                for (const value of values) {
                    ctx.scope[loopVarName] = value;
                    for (const block of c.body) {
                        const result = this.runCodeBlock(ctx, block);
                        if (result instanceof ReturnSignal) return result;
                    }
                }
                break;
            }
            case 'RemindStatement': {
                const c = code as unknown as RemindStatement;
                const pin = c.pin ? this.resolveRefChainToStatePath(ctx, c.pin) : undefined;

                // No `after`: fire the instant this statement runs - record it and run
                // any effect body in this same context. It never enters the time queue.
                if (!c.delay) {
                    const fired: FiredReminder = {
                        id: randomUUID(),
                        label: c.label,
                        severity: c.severity ?? 'info',
                        createdAtRound: ctx.clock,
                        firedAtRound: ctx.clock,
                        pin,
                        effectRan: false,
                    };
                    ctx.firedReminders?.push(fired);
                    if (c.body) {
                        this.runCodeBlock(ctx, c.body);
                        fired.effectRan = true;
                    }
                    break;
                }

                const amount = this.evaluateExpression(ctx, c.delay.amount);
                if (typeof amount !== 'number') throw new Error(`Duration amount must evaluate to a number`);
                const delayRounds = durationToRounds(amount, c.delay.unit);
                const bodyLocator = c.body ? computeRemindBodyLocator(c) : undefined;
                ctx.reminders.push({
                    id: randomUUID(),
                    label: c.label,
                    severity: c.severity ?? 'info',
                    createdAtRound: ctx.clock,
                    fireAtRound: ctx.clock + delayRounds,
                    pin,
                    bodyLocator,
                });
                break;
            }
        }
        return undefined;
    }

    private dispatchTriggerHandlers(ctx: EvalContext, eventName: string): void {
        const handlers = ctx.triggerHandlers?.get(eventName);
        if (!handlers?.length) return;
        for (const block of handlers) {
            if (ctx.firedHandlers?.has(block)) continue;
            this.fireHandler(ctx, block, `on trigger ${eventName}`);
        }
    }

    /**
     *  Runs a matched handler's body as its own cascade frame: marked fired before the
     *  body runs (so a write inside it can't re-trigger itself), and handlerDepth is
     *  incremented for the body's duration so nested writes/prints/triggers nest
     *  correctly under it in the events tree.
     **/
    private fireHandler(ctx: EvalContext, block: OnBlock, label: string): void {
        (ctx.firedHandlers ??= new Set()).add(block);
        this.runInFrame(ctx, block.$container, label, () => this.runCodeBlock(ctx, block.body));
    }

    /**
     *  One cascade frame: `this`/`parent` bound to `owner`, a `handler` event logged, and
     *  everything `run` does nested under it. Shared by change/trigger handlers and a
     *  quest or objective's `on completed` / `on failed` blocks.
     **/
    private runInFrame(ctx: EvalContext, owner: OwningObject, label: string, run: () => void): void {
        if ((ctx.handlerDepth ?? 0) >= MAX_CASCADE_DEPTH) {
            throw new Error(`Handlers and quest blocks are nested more than ${MAX_CASCADE_DEPTH} deep; they probably set each other off in a loop.`);
        }
        ctx.handlerDepth = (ctx.handlerDepth ?? 0) + 1;
        const previousThis = ctx.thisEntity;
        const previousParent = ctx.parentEntity;
        ctx.thisEntity = owner;
        ctx.parentEntity = parentOwningObject(owner);
        ctx.events?.push({ kind: 'handler', label, depth: this.cascadeDepth(ctx) });
        try {
            run();
        } finally {
            ctx.handlerDepth = (ctx.handlerDepth ?? 1) - 1;
            ctx.thisEntity = previousThis;
            ctx.parentEntity = previousParent;
        }
    }

    /**
     *  `accept` / `complete` / `fail` on a quest or objective. Returns whether it applied:
     *  an action that does not fit the current Status (`accept` on a quest that is not
     *  Available, anything on a finished one) is a silent no-op, so a script or handler can
     *  call these defensively. The new Status is written first, so the `on completed` /
     *  `on failed` blocks it then runs, and any action they take, already see it,
     *  which also stops a block from re-firing its own transition.
     **/
    applyStatusAction(ctx: EvalContext, entity: Quest | Objective, action: StatusAction): boolean {
        const transition = statusTransition(this.statusKindOf(entity), action, this.readPath(ctx, this.statusPathOf(entity)));
        if (!transition) return false;

        this.enterStatus(ctx, entity, transition.to, transition.runs);
        return true;
    }

    /**
     *  `set quest "X" . Status = ...`. Unlike the statements it does not check the transition
     *  rules, so it can jump anywhere and move backwards, but arriving at Succeeded/Completed
     *  or Failed runs the matching block just like `complete` / `fail` would. Setting the
     *  status it already has runs nothing, so a block that sets its own quest does not loop.
     **/
    private setStatus(ctx: EvalContext, entity: Quest | Objective, value: unknown): void {
        const arrived = typeof value === 'string' && value !== this.statusOf(ctx, entity);
        const runs = arrived ? statusBlockFor(this.statusKindOf(entity), value) : undefined;
        this.enterStatus(ctx, entity, value as string, runs);
    }

    /** Writes the new status first, then runs the block it triggers, so both already see it. */
    private enterStatus(ctx: EvalContext, entity: Quest | Objective, to: string, runs: StatusBlock | undefined): void {
        this.pushWrite(ctx, this.statusPathOf(entity), to);
        const blocks = runs ? entity[runs] : [];
        if (blocks.length > 0) {
            this.runInFrame(ctx, entity, `on ${runs} ${this.statusKindOf(entity)} "${entity.name}"`, () => {
                for (const block of blocks) this.runCodeBlock(ctx, block);
            });
        }
    }

    /** The quest or objective `path` is the Status of, or undefined for any other path. */
    private statusOwner(ctx: EvalContext, path: StatePath): Quest | Objective | undefined {
        const [owner, variable] = path;
        if (path.length !== 2 || variable.kind !== 'variable' || variable.target !== STATUS_VARIABLE) return undefined;
        if (owner.kind !== 'quest' && owner.kind !== 'objective') return undefined;
        const node = ctx.model && statePathToNode(ctx.model, [owner]);
        return isQuest(node) || isObjective(node) ? node : undefined;
    }

    private statusKindOf(entity: Quest | Objective): StatusKind {
        return isQuest(entity) ? 'quest' : 'objective';
    }

    private statusPathOf(entity: Quest | Objective): StatePath {
        return isQuest(entity) ? questStatusPath(entity.name) : objectiveStatusPath(entity.$container.name, entity.name);
    }

    /** The current status, seeing this command's own earlier writes. */
    private statusOf(ctx: EvalContext, entity: Quest | Objective): string {
        return statusOrDefault(this.statusKindOf(entity), this.readPath(ctx, this.statusPathOf(entity)));
    }

    /**
     *  The automatic half of the status machine. Every command ends with this, so a quest
     *  unlocks (`enabled`) and a started quest or an objective finishes (`requierement`) the
     *  moment its condition becomes true, whatever caused it.
     *
     *  Repeated until nothing changes, so a transition made during the pass (a quest that
     *  completes, and the `on completed` block that unlocks another one declared earlier in
     *  the file) is picked up in the same command regardless of declaration order. Unlike
     *  `on change` handlers this cannot loop: a status only ever moves forward, so each
     *  entity transitions at most once and the pass count is bounded by their number.
     *
     *  An objective is only checked while its quest is Started, so a `requierement true`
     *  does not finish it before the quest has even been accepted. The explicit
     *  `complete objective` statement is not gated.
     **/
    recheckQuestStatuses(ctx: EvalContext): void {
        const quests = ctx.model?.World?.quests;
        if (!quests?.length) return;
        const maxPasses = quests.reduce((total, quest) => total + 1 + quest.objectives.length, 1);
        for (let pass = 0; pass < maxPasses && this.recheckPass(ctx, quests); pass++) { /* until stable */ }
    }

    private recheckPass(ctx: EvalContext, quests: Quest[]): boolean {
        let changed = false;
        for (const quest of quests) {
            const status = this.statusOf(ctx, quest);
            if (status === 'Unavailable') {
                // No `enabled` clause means nothing gates it: with no statement that could
                // make it Available by hand, it would otherwise never be startable.
                changed = this.autoTransition(ctx, quest, quest.enabled[0], 'enable', true) || changed;
            } else if (status === 'Started') {
                changed = this.autoTransition(ctx, quest, quest.requierement[0], 'complete', false) || changed;
            }
            // Read again: the quest may just have finished above.
            if (this.statusOf(ctx, quest) !== 'Started') continue;
            for (const objective of quest.objectives) {
                if (this.statusOf(ctx, objective) === 'Incomplete') {
                    changed = this.autoTransition(ctx, objective, objective.requierement[0], 'complete', false) || changed;
                }
            }
        }
        return changed;
    }

    /**
     *  Applies `action` if `condition` holds now. `whenMissing` is the answer when there is
     *  no condition: `enabled` defaults to open, `requierement` to "only by hand".
     **/
    private autoTransition(ctx: EvalContext, entity: Quest | Objective, condition: Expression | undefined, action: StatusAction, whenMissing: boolean): boolean {
        return this.guarded(ctx, `${this.statusKindOf(entity)} "${entity.name}" ${action}`, () =>
            (condition ? Boolean(this.evaluateExpression(ctx, condition)) : whenMissing) && this.applyStatusAction(ctx, entity, action));
    }

    private readonly warnedAutoTransitions = new Set<string>();

    /**
     *  Runs one automatic transition so that a broken condition or `on completed` block
     *  cannot take every later command down with it - this pass runs on all of them, and a
     *  throw would otherwise repeat forever. On an error it undoes whatever the attempt
     *  queued, reports it once to the console, and counts as "did not apply"; that entity
     *  is simply tried again on the next command.
     **/
    private guarded(ctx: EvalContext, label: string, run: () => boolean): boolean {
        const mark = {
            writes: ctx.pendingOverlayWrites?.length ?? 0,
            events: ctx.events?.length ?? 0,
            reminders: ctx.reminders.length,
            fired: ctx.firedReminders?.length ?? 0,
        };
        try {
            return run();
        } catch (e) {
            ctx.pendingOverlayWrites?.splice(mark.writes);
            ctx.events?.splice(mark.events);
            ctx.reminders.splice(mark.reminders);
            ctx.firedReminders?.splice(mark.fired);
            const message = e instanceof Error ? e.message : String(e);
            const key = `${label}: ${message}`;
            if (!this.warnedAutoTransitions.has(key)) {
                this.warnedAutoTransitions.add(key);
                console.warn(`[quest status] ${label} skipped: ${message}`);
            }
            return false;
        }
    }

    /** 
     *  Resolves a RefChain to its StatePath address rather than its value 
     *  Used by RemindStatement's `show on <chain>` pin and by `set <chain> = <expr>`.
     **/
    private resolveRefChainToStatePath(ctx: EvalContext, chain: RefChain): StatePath {
        const head = chainHead(chain);
        if (this.isItemChain(chain)) return this.resolveItemTarget(ctx, chain).path;
        // A for-loop-bound entity - same shortcut evaluateRefChain's fallback uses.
        if (isVariableRefItem(head)) {
            const headDecl = head.val.val.ref;
            const headValue = headDecl ? ctx.scope[headDecl.target ?? headDecl.name ?? ''] : undefined;
            if (isLoopEntityHandle(headValue)) {
                if (chain.rest.length === 0) return headValue.path;
                const tailName = chain.rest[0].val.val.$refText;
                return [...headValue.path, { kind: 'variable', target: tailName }];
            }
        }
        if (chain.rest.length === 0 && isThisRefItem(head)) {
            if (!ctx.thisEntity) throw new Error(`'this' is not available here`);
            const path = nodeToStatePath(ctx.thisEntity);
            if (!path) throw new Error(`'this' has no persistent address here`);
            return path;
        }
        if (chain.rest.length === 0 && isParentRefItem(head)) {
            if (!ctx.parentEntity) throw new Error(`'parent' is not available here`);
            const path = nodeToStatePath(ctx.parentEntity);
            if (!path) throw new Error(`'parent' has no persistent address here`);
            return path;
        }
        return this.resolveStaticRefChainToStatePath(chain);
    }

    /** A chain that picks an item of an entity collection, or carries on after an index: its address is only known when it runs. */
    private isItemChain(chain: RefChain): boolean {
        return !!chain.next || (!!chain.field && chain.indexes.length > 0);
    }

    /** Where `set` stores: the variable's address, plus the list indexes (`Items[1]`) when it replaces one item of a list. */
    private resolveSetTarget(ctx: EvalContext, chain: RefChain): { path: StatePath; indexes: unknown[] } {
        if (this.isItemChain(chain)) return this.resolveItemTarget(ctx, chain);
        let path: StatePath;
        try {
            path = this.resolveRefChainToStatePath(ctx, chain);
        } catch {
            path = [];
        }
        return { path, indexes: chain.indexes.map(index => this.evaluateExpression(ctx, index)) };
    }

    /**
     *  The address a chain through an indexed entity item names (`quest "Q" . objectives[0] . Status`), found by
     *  walking to the item at run time, then appending the members after it. Any indexes on that last segment
     *  are returned, not applied: they pick an item of the list the variable holds.
     **/
    private resolveItemTarget(ctx: EvalContext, chain: RefChain): { path: StatePath; indexes: unknown[] } {
        let item = this.evaluateFirstSegment(ctx, chain);
        let tail = chain.next;
        if (!tail) {
            if (!isLoopEntityHandle(item)) throw new Error(`Expected an entity item, not ${this.describeItem(item)}.`);
            return { path: item.path, indexes: [] };
        }
        while (tail.next) {
            item = this.evaluateTail(ctx, item, tail);
            tail = tail.next;
        }
        if (!isLoopEntityHandle(item)) throw new Error(`Cannot store through ${this.describeItem(item)}; it needs an item of a collection of entities.`);
        const field: string | undefined = tail.field;
        if (field) throw new Error(`'.${field}' is read-only.`);
        const members: StatePath = tail.rest.map(member => ({ kind: 'variable' as const, target: member.val.val.$refText }));
        return { path: [...item.path, ...members], indexes: tail.indexes.map(index => this.evaluateExpression(ctx, index)) };
    }

    /** What a `for` iterates: a collection field straight off its head, or any chain that evaluates to a list. */
    private iterationValues(ctx: EvalContext, source: RefChain): unknown[] {
        if (source.field && source.indexes.length === 0 && !source.next) return this.resolveFieldValue(ctx, source) as unknown[];
        return this.resolveListSource(ctx, source);
    }

    /** 
     * `for x in <variable holding a list>` - iterates a snapshot of the list, 
     * so a write-back to the same variable inside the body doesn't change what is iterated.
     **/
    private resolveListSource(ctx: EvalContext, source: RefChain): unknown[] {
        const value = this.evaluateRefChain(ctx, source);
        if (!Array.isArray(value)) {
            throw new Error(`'for ... in' needs a list, but ${source.$cstNode?.text ?? 'the source'} is not one`);
        }
        return [...value];
    }

    /** 
     *  A statement-position call of a predefined function flagged `writesBack` (see PREDEFINED_SIGNATURES) 
     *  also stores its result into its first argument, so:
     *  `call predefined append with inventory, "sword"` reads as a mutation while the function itself stays pure.
     *  The validator guarantees the first argument is a variable.
     *  In expression position nothing is written - only this statement case of `runCode` calls this.
     **/
    private writeBackIfRequested(ctx: EvalContext, call: FunctionCall, result: unknown): void {
        if (!call.predefined || !getPredefinedSignature(call.predefinedTarget ?? '')?.writesBack) return;
        const target = unwrapExpression(call.params[0]);
        if (!isRefChain(target)) throw new Error(`'${call.predefinedTarget}' needs a variable as its first argument`);
        this.writeValue(ctx, target, result);
    }

    /** 
     *  How deeply nested the current write/print/trigger is inside cascading effects
     *  Chained event triggers and handler firings both count as one frame each, 
     *  so the events tree renders them at consistent nesting regardless of which caused it. 
     **/
    private cascadeDepth(ctx: EvalContext): number {
        return (ctx.triggeredEvents?.size ?? 0) + (ctx.handlerDepth ?? 0);
    }

    /** 
     *  Records a persistent write: queues it for the caller to flush to the overlay,
     *  and logs it in `ctx.events` at the position it actually ran, so print output
     *  and writes can be rendered interleaved instead of grouped by kind. 
     **/
    private pushWrite(ctx: EvalContext, path: StatePath, value: unknown): void {
        assertValidStatusWrite(path, value);
        const before = this.readPath(ctx, path);
        (ctx.pendingOverlayWrites ??= []).push({ path, value });
        ctx.events?.push({ kind: 'write', path, value, depth: this.cascadeDepth(ctx) });
        this.dispatchChangeHandlers(ctx, path, before, value);
    }

        private dispatchChangeHandlers(ctx: EvalContext, path: StatePath, before: unknown, after: unknown): void {
        const handlers = ctx.changeHandlers?.get(encodeStatePath(path));
        if (!handlers?.length) return;
        for (const block of handlers) {
            if (ctx.firedHandlers?.has(block)) continue;
            const occ = block.occurrence as ChangeOccurrence;
            if (this.changeHandlerMatches(ctx, occ, before, after)) {
                this.fireHandler(ctx, block, `on change ${occ.target.$cstNode?.text ?? ''}`);
            }
        }
    }

    /** 
     *  Edge-triggered on all three `ChangeOccurrence` shapes, not just the pre/post-value it's checked against
     *  otherwise fires on the write that actually caused it, 
     *  `firedHandlers` a no-op rewrite (same value written again) would spuriously refire it every time. 
     **/
    private changeHandlerMatches(ctx: EvalContext, occ: ChangeOccurrence, before: unknown, after: unknown): boolean {
        if (occ.toValue) {
            const target = this.evaluateExpression(ctx, occ.toValue);
            return !this.valuesEqual(before, target) && this.valuesEqual(after, target);
        }
        if (occ.guard) {
            const afterMatch = Boolean(this.evaluateExpression(ctx, occ.guard));
            if (!afterMatch) return false;
            const pending = ctx.pendingOverlayWrites!;
            const thisWrite = pending.pop()!;
            const beforeMatch = Boolean(this.evaluateExpression(ctx, occ.guard));
            pending.push(thisWrite);
            return !beforeMatch;
        }
        return !this.valuesEqual(before, after);
    }

    private valuesEqual(a: unknown, b: unknown): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /** 
     *  Stores `value` into the variable a chain names: a bare local variable lands in
     *  the scope, an entity- or world-owned one (or a loop entity's member) becomes a
     *  pending overlay write for the caller to flush. 
     **/
    private writeValue(ctx: EvalContext, chain: RefChain, value: unknown): void {
        const head = chainHead(chain);
        if (this.isItemChain(chain)) {
            const { path, indexes } = this.resolveItemTarget(ctx, chain);
            if (path[path.length - 1]?.kind !== 'variable') throw new Error('Cannot store into a target that is not a variable');
            this.pushWrite(ctx, path, indexes.length === 0 ? value : replaceAtIndexes(this.readPath(ctx, path), indexes, value));
            return;
        }
        const indexes = chain.indexes.map(index => this.evaluateExpression(ctx, index));
        // With `[i]` the value replaces one item of the list the variable holds, not the variable.
        const stored = (whole: unknown) => indexes.length === 0 ? value : replaceAtIndexes(whole, indexes, value);

        if (chain.rest.length === 0 && isVariableRefItem(head)) {
            const ref = head.val.val;
            const decl = ref.ref;
            const path = decl ? nodeToStatePath(decl) : undefined;
            if (path) {
                this.pushWrite(ctx, path, stored(this.readPath(ctx, path)));
            } else {
                const name = decl?.target ?? decl?.name ?? ref.$refText;
                ctx.scope[name] = stored(ctx.scope[name]);
            }
            return;
        }
        const path = this.resolveRefChainToStatePath(ctx, chain);
        if (path[path.length - 1]?.kind !== 'variable') {
            throw new Error('Cannot store into a target that is not a variable');
        }
        this.pushWrite(ctx, path, stored(this.readPath(ctx, path)));
    }

    /** 
     *  Resolves a `for`'s collection *source* to the values the loop variable takes on,
     *  one iteration each. `DndDslValidator.checkCollectionField` already rejects an
     *  unknown field at parse time, so `field` here is trusted to be legal for `head`'s
     *  resolved type - this only decides, per field, what an element becomes. 
     **/
    private resolveFieldValue(ctx: EvalContext, chain: RefChain): unknown {
        const start = chainHead(chain);
        const head = this.resolveCollectionHead(ctx, start);
        if (!head) throw new Error(`Unresolved collection head: ${start.$type}`);
        return this.fieldValueOf(ctx, head, chain.field!);
    }

    /** What `<entity> . <field>` is: a scalar read straight off the node, or the collection with each item as its runtime shape. */
    private fieldValueOf(ctx: EvalContext, head: AstNode, field: string): unknown {
        // Scalar fields read straight off the entity node.
        if (field === 'name' || field === 'description') {
            return (head as unknown as Record<string, unknown>)[field];
        }

        const items = (head as unknown as Record<string, unknown>)[field];
        if (!Array.isArray(items)) throw new Error(`'${field}' is not a collection on ${head.$type}`);
        switch (field) {
            // Entities with their own `.variables` - bind a live handle so `x.member`
            // reads/writes persist through the entity's real StatePath.
            case 'npcs': case 'factions': case 'locations': case 'quests': case 'objectives': case 'sublocations':
                return (items as AstNode[])
                    .map(node => this.makeEntityHandle(node))
                    .filter((handle): handle is LoopEntityHandle => handle !== undefined);
            // Named, but no `.variables` of their own - bind the name only.
            case 'events': case 'functions': case 'enums':
                return (items as { name: string }[]).map(node => node.name);
            // EnumValueDecl - same runtime representation as an EnumValueRef elsewhere
            // in the interpreter (a bare name string), not an entity.
            case 'values':
                return (items as EnumValueDecl[]).map(v => v.name);
            // LocationExit - not StatePath-addressable, so a small plain record instead
            // of a live handle; `target` resolves the exit's own cross-reference.
            case 'exits':
                return (items as LocationExit[]).map(exit => ({ name: exit.name, target: exit.exit?.ref?.name }));
            // The VariableDeclarations themselves - bind each one's current value.
            case 'variables':
                return (items as VariableDeclaration[]).map(v => {
                    // The declaration's own value is the initial one; the current value is in the served state.
                    const path = nodeToStatePath(v);
                    return path ? this.readPath(ctx, path) : v.value ? this.evaluateExpression(ctx, v.value) : undefined;
                });
            default:
                throw new Error(`Unsupported collection field: ${field}`);
        }
    }

    /** 
     *  Resolves a CollectionRef's head to the concrete node its field is read off.
     *  Location/Quest/Npc/Faction reuse their existing cross-reference; World has none 
     *  (only one per document); Enum's is a direct [Enum:ID] reference 
     *  (see the grammar comment on EnumRefItem) resolved by Langium's own default scoping.
     *  A VariableRefItem head is only meaningful here when it's a `for`-loop variable
     *  bound to a LoopEntityHandle - its path is resolved back to the live node. 
     **/
    private resolveCollectionHead(ctx: EvalContext, start: ChainHead): AstNode | undefined {
        if (isLocationRefItem(start)) return start.val.val.ref;
        if (isQuestRefItem(start)) return start.val.val.ref;
        if (isObjectiveRefItem(start)) return start.val.val.ref;
        if (isNpcRefItem(start)) return start.val.val.ref;
        if (isFactionRefItem(start)) return start.val.val.ref;
        if (isWorldRefItem(start)) return ctx.model?.World;
        if (isEnumRefItem(start)) return start.val.ref;
        if (isThisRefItem(start)) return ctx.thisEntity;
        if (isParentRefItem(start)) return ctx.parentEntity;
        if (isVariableRefItem(start)) {
            const decl = start.val.val.ref;
            const value = decl ? ctx.scope[decl.target ?? decl.name ?? ''] : undefined;
            if (isLoopEntityHandle(value)) {
                if (!ctx.model) throw new Error(`No live model available to resolve '${decl?.name}'`);
                return statePathToNode(ctx.model, value.path) as AstNode | undefined;
            }
        }
        return undefined;
    }

    private makeEntityHandle(node: AstNode): LoopEntityHandle | undefined {
        const path = nodeToStatePath(node);
        if (!path) return undefined;
        return { __loopEntity: true, path };
    }
}
