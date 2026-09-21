import { randomUUID } from 'crypto';
import type { AstNode } from 'langium';
import {
    Code,
    CodeBlock,
    CollectionRef,
    ConditionalBlock,
    EnumValueDecl,
    Expression,
    ForStatement,
    FunctionCall,
    FunctionDeclaration,
    isBoolExpression,
    isBoolVal,
    isEnumRefItem,
    isEnumValueRef,
    isEventRefItem,
    isFunctionCall,
    isGroupedExpression,
    isIntExpression,
    isIntToBoolExpression,
    isIntVal,
    isListLiteral,
    isLocation,
    isLocationRefItem,
    isNpc,
    isNpcRefItem,
    isObjectDeclaration,
    isObjective,
    isQuest,
    isQuestRefItem,
    isRefChain,
    isStringVal,
    isVariableRefItem,
    isWorld,
    isWorldRefItem,
    LocationExit,
    Model,
    PrintStatement,
    RefChain,
    RefChainStart,
    RemindStatement,
    ReturnStatement,
    SetStatement,
    VariableDeclaration,
} from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';
import { predefinedFunctionsAsMap } from '../predefined/predefined-functions';
import { encodeStatePath, nodeToStatePath, statePathToNode, unwrapExpression, type StatePath } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import { getPredefinedSignature } from '@dnd-language/evaluation/dnd-dsl-predefined-signatures.js';
import { buildVariablesRecord, evaluateSerializedExpression } from '@dnd-language/evaluation/dnd-dsl-value-evaluator.js';
import type { SerializedModel } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { durationToRounds } from '@dnd-language/evaluation/dnd-dsl-clock.js';
import { applyArithmetic, applyComparison, applyLogical, negatableBool, signedInt } from '@dnd-language/evaluation/dnd-dsl-expression-ops.js';
import { computeRemindBodyLocator, type FiredReminder, type ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';

type RuntimeScope = Record<string, any>;

/**
 * Threaded explicitly through every interpreter entry point rather than injected -
 * WorldStateService already has a (currently unused) constructor dependency on this
 * service, so the reverse edge would be a real DI cycle. `worldState` is the current,
 * overlay-applied JSON world state (WorldStateService.getWorldState()), used to resolve
 * persistent (Location-owned) RefChain reads; `scope` is the local/function runtime scope;
 * `clock`/`reminders` back RemindStatement scheduling; `model` is the loaded live AST
 * (used to dispatch `trigger` by name); `pendingOverlayWrites` collects entity-variable
 * writes from `set` / assignment for the caller to flush; `triggeredEvents` guards
 * against `trigger` recursion; `firedReminders` collects `remind` statements with no
 * `after` clause, which fire the instant they run rather than entering the time queue;
 * `printed` collects the values of `print` statements for the caller to surface.
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
    printed?: unknown[];
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
 * circular AST reference ends up in `ctx.scope`/`ctx.printed` (which would break
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
        if (isIntVal(expression)) {
            return signedInt(expression);
        }
        if (isBoolVal(expression)) {
            return negatableBool(expression);
        }
        if (isStringVal(expression)) {
            return expression.val;
        }
        if (isEnumValueRef(expression)) {
            // Runtime value of an enum reference is its value name - keeps `is` / `==`
            // as plain string comparison and matches the bare name string an
            // ASSIGN_VARIABLE overlay write stores.
            return expression.value.ref?.name ?? expression.value.$refText;
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
        if (isRefChain(expression)) {
            return this.evaluateRefChain(ctx, expression);
        }
        if (isFunctionCall(expression)) {
            return this.executeFunctionCall(ctx, expression);
        }

        if(expression.$type === 'Expression'){
            return this.evaluateExpression(ctx, expression.exp);
        }

        throw new Error(`Unhandled expression type: ${expression.$type}`);
    }

    private evaluateRefChain(ctx: EvalContext, chain: RefChain): any {
        if (isEventRefItem(chain.first)) {
            throw new Error(`RefChain heads of kind '${chain.first.$type}' are not supported yet`);
        }

        if (chain.rest.length === 0) {
            if (isLocationRefItem(chain.first)) {
                const loc = chain.first.val.val.ref;
                if (!loc) throw new Error(`Unresolved location ref: ${chain.first.val.val.$refText}`);
                return this.readPersistentValue(ctx.worldState, [{ kind: 'location', name: loc.name }]);
            }
            if (isQuestRefItem(chain.first)) {
                const q = chain.first.val.val.ref;
                if (!q) throw new Error(`Unresolved quest ref: ${chain.first.val.val.$refText}`);
                return this.readPersistentValue(ctx.worldState, [{ kind: 'quest', name: q.name }]);
            }
            if (isNpcRefItem(chain.first)) {
                const n = chain.first.val.val.ref;
                if (!n) throw new Error(`Unresolved npc ref: ${chain.first.val.val.$refText}`);
                return this.readPersistentValue(ctx.worldState, [{ kind: 'npc', name: n.name }]);
            }
        }

        // Every remaining shape ends in a VariableRefItem - either chain.first itself
        // (a bare or location-qualified-with-rest variable chain) or the last chain.rest
        // item. Once scoping links each segment directly to its target, no per-segment
        // key-walk is needed for the persistent case - nodeToStatePath on the tail alone
        // recovers the full path back to the syntactic root.
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chain.first;
        if (!isVariableRefItem(tail)) {
            throw new Error(`Unsupported RefChain tail: ${tail.$type}`);
        }
        const decl = tail.val.val.ref;
        if (!decl) throw new Error(`Unresolved variable ref in chain: ${tail.val.val.$refText}`);

        const path = nodeToStatePath(decl);
        if (path) return this.readPath(ctx, path);

        // Local/function-scoped - nodeToStatePath only returns a path for a
        // Location-rooted declaration, so chain.first can't be a LocationRefItem here;
        // it must itself be a VariableRefItem. No StatePath bridge exists for it - walk
        // ctx.scope by name instead.
        if (!isVariableRefItem(chain.first)) {
            throw new Error(`Unsupported RefChain head: ${chain.first.$type}`);
        }
        const headDecl = chain.first.val.val.ref;
        if (!headDecl) throw new Error(`Unresolved variable ref: ${chain.first.val.val.$refText}`);
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

    /** A persistent read that sees this run's own not-yet-flushed writes: the newest
     *  pending write to exactly this path wins, else the served state is read. Without
     *  it a second `append` on a persistent list would start from the old value and
     *  lose the first. Only an exact path is matched - a parent record read after a
     *  write to one of its members still reflects the served state. */
    private readPath(ctx: EvalContext, path: StatePath): any {
        const pending = ctx.pendingOverlayWrites;
        if (pending?.length) {
            const key = encodeStatePath(path);
            for (let i = pending.length - 1; i >= 0; i--) {
                if (encodeStatePath(pending[i].path) === key) return structuredClone(pending[i].value);
            }
        }
        return this.readPersistentValue(ctx.worldState, path);
    }

    /** Reads the current (overlay-applied) value a persistent StatePath addresses, from
     *  the served worldState JSON - never the live AST, whose VariableDeclaration.value
     *  nodes are never touched post-parse (see WorldStateService.spliceOverlayValue). */
    private readPersistentValue(worldState: SerializedModel, path: StatePath): any {
        const node = statePathToNode(worldState as unknown as Model, path) as any;
        if (!node) return undefined; // renamed/removed since linking - soft-fail
        if (isLocation(node) || isObjectDeclaration(node) || isNpc(node) || isQuest(node) || isObjective(node) || isWorld(node)) {
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
            printed: callerCtx.printed,
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

    /** Runs a DM script body and returns its `return` value (or undefined). Entity
     *  writes land in `ctx.pendingOverlayWrites` for the caller to flush. */
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
                    ctx.pendingOverlayWrites.push({ path, value });
                } else {
                    ctx.scope[decl?.target ?? decl?.name ?? ''] = value;
                }
                break;
            }
            case 'SetStatement': {
                const c = code as unknown as SetStatement;
                const value = this.evaluateExpression(ctx, c.value);
                let path: StatePath;
                try {
                    path = this.resolveRefChainToStatePath(ctx, c.target);
                } catch {
                    path = [];
                }
                if (path[path.length - 1]?.kind !== 'variable') {
                    throw new Error('`set` needs an entity variable target, e.g. `set npc "X" . mood = ...`');
                }
                (ctx.pendingOverlayWrites ??= []).push({ path, value });
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
                ctx.printed?.push(value);
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
                if (seen.has(name)) break; // re-entrancy guard
                seen.add(name);
                try {
                    this.triggerEventByName(ctx.model, name, ctx);
                } finally {
                    seen.delete(name);
                }
                break;
            }
            case 'ForStatement': {
                const c = code as unknown as ForStatement;
                const loopVarName = c.loopVar.name ?? '';
                const values = c.collection ? this.resolveCollection(ctx, c.collection) : this.resolveListSource(ctx, c.source!);
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

    /** Resolves a RefChain to its StatePath address rather than its value - used by
     *  RemindStatement's `show on <chain>` pin and by `set <chain> = <expr>`. Mirrors
     *  evaluateRefChain's head/tail resolution and throw conventions. */
    private resolveRefChainToStatePath(ctx: EvalContext, chain: RefChain): StatePath {
        if (isEventRefItem(chain.first)) {
            throw new Error(`Cannot pin a reminder to a '${chain.first.$type}' reference`);
        }
        if (chain.rest.length === 0
            && (isLocationRefItem(chain.first) || isQuestRefItem(chain.first) || isNpcRefItem(chain.first))) {
            const node = chain.first.val.val.ref;
            if (!node) throw new Error(`Unresolved ref: ${chain.first.val.val.$refText}`);
            return nodeToStatePath(node)!;
        }

        // A for-loop-bound entity - same shortcut evaluateRefChain's fallback uses.
        if (isVariableRefItem(chain.first)) {
            const headDecl = chain.first.val.val.ref;
            const headValue = headDecl ? ctx.scope[headDecl.target ?? headDecl.name ?? ''] : undefined;
            if (isLoopEntityHandle(headValue)) {
                if (chain.rest.length === 0) return headValue.path;
                const tailName = chain.rest[0].val.val.$refText;
                return [...headValue.path, { kind: 'variable', target: tailName }];
            }
        }

        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chain.first;
        if (!isVariableRefItem(tail)) throw new Error(`Unsupported pin target: ${tail.$type}`);
        const decl = tail.val.val.ref;
        if (!decl) throw new Error(`Unresolved variable ref: ${tail.val.val.$refText}`);
        const path = nodeToStatePath(decl);
        if (!path) throw new Error(`Cannot pin a reminder to a local/non-persistent variable`);
        return path;
    }

    /** `for x in <variable holding a list>` - iterates a snapshot of the list, so a
     *  write-back to the same variable inside the body doesn't change what is iterated. */
    private resolveListSource(ctx: EvalContext, source: RefChain): unknown[] {
        const value = this.evaluateRefChain(ctx, source);
        if (!Array.isArray(value)) {
            throw new Error(`'for ... in' needs a list, but ${source.$cstNode?.text ?? 'the source'} is not one`);
        }
        return [...value];
    }

    /** A statement-position call of a predefined function flagged `writesBack` (see
     *  PREDEFINED_SIGNATURES) also stores its result into its first argument, so
     *  `call predefined append with inventory, "sword"` reads as a mutation while the
     *  function itself stays pure. The validator guarantees the first argument is a
     *  variable. In expression position nothing is written - only this statement case
     *  of runCode calls this. */
    private writeBackIfRequested(ctx: EvalContext, call: FunctionCall, result: unknown): void {
        if (!call.predefined || !getPredefinedSignature(call.predefinedTarget ?? '')?.writesBack) return;
        const target = unwrapExpression(call.params[0]);
        if (!isRefChain(target)) throw new Error(`'${call.predefinedTarget}' needs a variable as its first argument`);
        this.writeValue(ctx, target, result);
    }

    /** Stores `value` into the variable a chain names: a bare local variable lands in
     *  the scope, an entity- or world-owned one (or a loop entity's member) becomes a
     *  pending overlay write for the caller to flush. */
    private writeValue(ctx: EvalContext, chain: RefChain, value: unknown): void {
        if (chain.rest.length === 0 && isVariableRefItem(chain.first)) {
            const ref = chain.first.val.val;
            const decl = ref.ref;
            const path = decl ? nodeToStatePath(decl) : undefined;
            if (path) {
                (ctx.pendingOverlayWrites ??= []).push({ path, value });
            } else {
                ctx.scope[decl?.target ?? decl?.name ?? ref.$refText] = value;
            }
            return;
        }
        const path = this.resolveRefChainToStatePath(ctx, chain);
        if (path[path.length - 1]?.kind !== 'variable') {
            throw new Error('Cannot store into a target that is not a variable');
        }
        (ctx.pendingOverlayWrites ??= []).push({ path, value });
    }

    /** Resolves a `for`'s collection *source* to the values the loop variable takes on,
     *  one iteration each. `DndDslValidator.checkCollectionField` already rejects an
     *  unknown field at parse time, so `field` here is trusted to be legal for `head`'s
     *  resolved type - this only decides, per field, what an element becomes. */
    private resolveCollection(ctx: EvalContext, collection: CollectionRef): unknown[] {
        const head = this.resolveCollectionHead(ctx, collection.head);
        if (!head) throw new Error(`Unresolved collection head: ${collection.head.$type}`);
        const items = (head as unknown as Record<string, unknown>)[collection.field];
        if (!Array.isArray(items)) {
            throw new Error(`'${collection.field}' is not a collection on ${head.$type}`);
        }

        switch (collection.field) {
            // Entities with their own `.variables` - bind a live handle so `x.member`
            // reads/writes persist through the entity's real StatePath.
            case 'npcs': case 'locations': case 'quests': case 'objectives': case 'sublocations':
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
                return (items as VariableDeclaration[]).map(v => v.value ? this.evaluateExpression(ctx, v.value) : undefined);
            default:
                throw new Error(`Unsupported collection field: ${collection.field}`);
        }
    }

    /** Resolves a CollectionRef's head to the concrete node its field is read off.
     *  Location/Quest/Npc reuse their existing cross-reference; World has none (only
     *  one per document); Enum's is a direct [Enum:ID] reference (see the grammar
     *  comment on EnumRefItem) resolved by Langium's own default scoping. */
    private resolveCollectionHead(ctx: EvalContext, start: RefChainStart): AstNode | undefined {
        if (isLocationRefItem(start)) return start.val.val.ref;
        if (isQuestRefItem(start)) return start.val.val.ref;
        if (isNpcRefItem(start)) return start.val.val.ref;
        if (isWorldRefItem(start)) return ctx.model?.World;
        if (isEnumRefItem(start)) return start.val.ref;
        return undefined;
    }

    private makeEntityHandle(node: AstNode): LoopEntityHandle | undefined {
        const path = nodeToStatePath(node);
        if (!path) return undefined;
        return { __loopEntity: true, path };
    }
}
