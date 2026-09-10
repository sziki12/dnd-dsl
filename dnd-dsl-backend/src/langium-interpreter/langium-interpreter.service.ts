import { randomUUID } from 'crypto';
import {
    Code,
    CodeBlock,
    ConditionalBlock,
    Expression,
    FunctionCall,
    FunctionDeclaration,
    isBoolExpression,
    isBoolVal,
    isEnumValueRef,
    isEventRefItem,
    isFunctionCall,
    isGroupedExpression,
    isIntExpression,
    isIntToBoolExpression,
    isIntVal,
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
    Model,
    RefChain,
    RemindStatement,
    ReturnStatement,
    SetStatement,
    VariableDeclaration,
} from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';
import { predefinedFunctionsAsMap } from '../predefined/predefined-functions';
import { nodeToStatePath, statePathToNode, type StatePath } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
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
 * `after` clause, which fire the instant they run rather than entering the time queue.
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
};

class ReturnSignal {
    constructor(public readonly value: any) {}
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
        if (path) return this.readPersistentValue(ctx.worldState, path);

        // Local/function-scoped - nodeToStatePath only returns a path for a
        // Location-rooted declaration, so chain.first can't be a LocationRefItem here;
        // it must itself be a VariableRefItem. No StatePath bridge exists for it - walk
        // ctx.scope by name instead.
        if (!isVariableRefItem(chain.first)) {
            throw new Error(`Unsupported RefChain head: ${chain.first.$type}`);
        }
        const headDecl = chain.first.val.val.ref;
        if (!headDecl) throw new Error(`Unresolved variable ref: ${chain.first.val.val.$refText}`);
        let current: any = ctx.scope[headDecl.target ?? headDecl.name ?? ''];
        for (const item of chain.rest) {
            const d = item.val.val.ref;
            if (!d) throw new Error(`Unresolved variable ref in chain: ${item.val.val.$refText}`);
            current = current?.[d.target ?? d.name ?? ''];
        }
        return current;
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
                    path = this.resolveRefChainToStatePath(c.target);
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
                this.executeFunctionCall(ctx, c);
                break;
            }
            case 'ReturnStatement': {
                const c = code as unknown as ReturnStatement;
                const value = c.returnValue ? this.evaluateExpression(ctx, c.returnValue) : undefined;
                return new ReturnSignal(value);
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
            case 'RemindStatement': {
                const c = code as unknown as RemindStatement;
                const pin = c.pin ? this.resolveRefChainToStatePath(c.pin) : undefined;

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
    private resolveRefChainToStatePath(chain: RefChain): StatePath {
        if (isEventRefItem(chain.first)) {
            throw new Error(`Cannot pin a reminder to a '${chain.first.$type}' reference`);
        }
        if (chain.rest.length === 0
            && (isLocationRefItem(chain.first) || isQuestRefItem(chain.first) || isNpcRefItem(chain.first))) {
            const node = chain.first.val.val.ref;
            if (!node) throw new Error(`Unresolved ref: ${chain.first.val.val.$refText}`);
            return nodeToStatePath(node)!;
        }
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chain.first;
        if (!isVariableRefItem(tail)) throw new Error(`Unsupported pin target: ${tail.$type}`);
        const decl = tail.val.val.ref;
        if (!decl) throw new Error(`Unresolved variable ref: ${tail.val.val.$refText}`);
        const path = nodeToStatePath(decl);
        if (!path) throw new Error(`Cannot pin a reminder to a local/non-persistent variable`);
        return path;
    }
}
