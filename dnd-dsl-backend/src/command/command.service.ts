import { Injectable } from '@nestjs/common';
import { WorldStateService } from '../world-state/world-state.service.js';
import { LangiumInterpreterService, type EvalContext, type InterpreterEvent } from '../langium-interpreter/langium-interpreter.service.js';
import { StateSyncGateway } from '../state-sync/state-sync.gateway.js';

import { isVariableDeclaration, type Model } from '@dnd-language/index.js';
import { encodeStatePath, resolveVariableContainer, statePathToNode } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import { durationToRounds } from '@dnd-language/evaluation/dnd-dsl-clock.js';
import { resolveRemindBodyLocator, type FiredReminder, type ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';
import {
  AckReminderCommand,
  AdvanceTimeCommand,
  AssignRuntimeVariableCommand,
  AssignVariableCommand,
  CallFunctionCommand,
  Command,
  CommandResponse,
  RunScriptCommand,
  ScriptEvent,
  TriggerEventCommand,
} from '@dnd-language/evaluation/dnd-dsl-commands.js';

/** Represents the state of the world at a specific point in time. */
type RuntimeStateSnapshot = {
  overlay: Record<string, unknown>;
  runtimeVars: Record<string, unknown>;
  clock: number;
  reminders: ScheduledReminder[];
  firedReminders: FiredReminder[];
};

const nonEmpty = <T,>(arr: T[]): T[] | undefined => (arr.length ? arr : undefined);

/** Represents a single command execution in the history, including the state before and after execution. */
type HistoryEntry = {
  command: Command;
  previous: RuntimeStateSnapshot;
  /** 
   *  Only captured for CALL_FUNCTION/TRIGGER_EVENT/ADVANCE_TIME. Lets redo restore the
   *  exact post-execution result instead of re-running the interpreter, which could be
   *  non-deterministic (predefined random function). Every other command
   *  type is deterministic, so its redo just reapplies the command instead. 
   **/
  post?: RuntimeStateSnapshot;
};

@Injectable()
export class CommandService {
  private readonly history: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(
    private readonly worldStateService: WorldStateService,
    private readonly interpreterService: LangiumInterpreterService,
    private readonly stateSyncGateway: StateSyncGateway,
  ) {}

  async execute(cmd: Command): Promise<CommandResponse> {
    const response = await this.dispatch(cmd);
    this.stateSyncGateway.broadcastState(response);
    return response;
  }

  private async dispatch(cmd: Command): Promise<CommandResponse> {
    if (cmd.type === 'CALL_FUNCTION') return this.executeCallFunction(cmd);
    if (cmd.type === 'TRIGGER_EVENT') return this.executeTriggerEvent(cmd);
    if (cmd.type === 'ADVANCE_TIME') return this.executeAdvanceTime(cmd);
    if (cmd.type === 'RUN_SCRIPT') return this.executeRunScript(cmd);

    const previous = this.snapshotRuntimeState();
    this.applyCommand(cmd);
    this.worldStateService.persistOverlay();
    this.history.push({ command: cmd, previous });
    this.future.splice(0);
    return this.buildResponse();
  }

  // Only the page StateSyncGateway currently considers "in control" may rewind the shared history.
  undo(clientId: string): CommandResponse {
    this.assertController(clientId);
    const entry = this.history.pop();
    if (entry) {
      this.future.unshift(entry);
      this.restoreRuntimeState(entry.previous);
      this.worldStateService.persistOverlay();
    }
    const response = this.buildResponse();
    this.stateSyncGateway.broadcastState(response);
    return response;
  }

  redo(clientId: string): CommandResponse {
    this.assertController(clientId);
    const entry = this.future.shift();
    if (entry) {
      if (entry.post) {
        this.restoreRuntimeState(entry.post);
      } else {
        this.applyCommand(entry.command);
      }
      this.worldStateService.persistOverlay();
      this.history.push(entry);
    }
    const response = this.buildResponse();
    this.stateSyncGateway.broadcastState(response);
    return response;
  }

  private assertController(clientId: string): void {
    if (!this.stateSyncGateway.isController(clientId)) {
      throw new Error('Only the page currently in control may undo/redo.');
    }
  }

  /** 
   *  Pushes the current state to every connected page with no change of its own.
   *  Used after a POST /parse reparse, which doesn't go through execute(). 
   **/
  notifyWorldReloaded(): void {
    this.stateSyncGateway.broadcastState(this.buildResponse());
  }

  private executeCallFunction(cmd: CallFunctionCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();

    const state = this.worldStateService.getWorldState();
    const ctx = this.newEvalContext(model, { ...(state.runtimeVariables ?? {}) });
    const result = this.interpreterService.callFunctionByName(model, cmd.functionName, cmd.args, ctx);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);
    this.flushPendingWrites(ctx);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return { ...this.buildResponse(), result, firedReminders: nonEmpty(ctx.firedReminders!), events: this.encodeEvents(ctx.events!) };
  }

  private executeTriggerEvent(cmd: TriggerEventCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();

    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};

    // Pass runtimeVariables directly so in-place mutations from VariableAssignment
    // and VariableDeclaration statements inside the event body persist.
    // The event itself counts as already running, so a self-`trigger` is guarded too.
    const ctx = this.newEvalContext(model, state.runtimeVariables, { triggeredEvents: new Set([cmd.eventName]) });
    this.interpreterService.triggerEventByName(model, cmd.eventName, ctx);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);
    this.flushPendingWrites(ctx);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return { ...this.buildResponse(), firedReminders: nonEmpty(ctx.firedReminders!), events: this.encodeEvents(ctx.events!) };
  }

  private executeAdvanceTime(cmd: AdvanceTimeCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();
    const justFired = this.worldStateService.advanceClock(durationToRounds(cmd.amount, cmd.unit));

    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};
    const firedFromBodies: FiredReminder[] = [];
    const allEvents: InterpreterEvent[] = [];
    for (const reminder of justFired) {
      if (!reminder.bodyLocator) continue;
      const codeBlock = resolveRemindBodyLocator(model, reminder.bodyLocator);
      if (!codeBlock) {
        console.warn(`Reminder '${reminder.id}' effect body no longer resolves - skipping.`);
        continue;
      }
      const ctx = this.newEvalContext(model, state.runtimeVariables, { firedReminders: firedFromBodies, events: allEvents });
      try {
        this.interpreterService.runCodeBlock(ctx, codeBlock);
        this.flushPendingWrites(ctx);
        reminder.effectRan = true;
      } catch (e) {
        console.error(`Reminder '${reminder.id}' effect body threw:`, e);
      }
    }
    this.worldStateService.addFiredReminders(firedFromBodies);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return { ...this.buildResponse(), firedReminders: [...justFired, ...firedFromBodies], events: this.encodeEvents(allEvents) };
  }

  /** 
   *  Parses + links the script against the loaded world, runs it in isolation
   *  (scope/reminders are copies, entity writes are deferred), then commits
   *  everything as one HistoryEntry. A parse or runtime failure commits nothing. 
   **/
  private async executeRunScript(cmd: RunScriptCommand): Promise<CommandResponse> {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No world is loaded');

    const previous = this.snapshotRuntimeState();

    const { codeBlock, errors } = await this.worldStateService.parseScript(cmd.source);
    if (errors.length || !codeBlock) {
      throw new Error(errors.map(e => `line ${e.line + 1}: ${e.message}`).join('\n') || 'Empty script');
    }

    const state = this.worldStateService.getWorldState();
    const ctx = this.newEvalContext(model, { ...(state.runtimeVariables ?? {}) }, {
      reminders: structuredClone(this.worldStateService.getReminders()),
    });

    let returnValue: unknown;
    try {
      returnValue = this.interpreterService.runScript(ctx, codeBlock);
    } catch (e) {
      throw new Error(`Script failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    state.runtimeVariables = ctx.scope;
    this.worldStateService.setReminders(ctx.reminders);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);
    this.flushPendingWrites(ctx);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return {
      ...this.buildResponse(),
      firedReminders: nonEmpty(ctx.firedReminders!),
      events: this.encodeEvents(ctx.events!),
      scriptResult: { returnValue },
    };
  }

  /** 
   *  The one place the interpreter context is built, so every command path gets the same
   *  capabilities: `trigger` needs `model`, and entity writes need `pendingOverlayWrites` plus a flush 
   **/
  private newEvalContext(model: Model, scope: Record<string, unknown>, extras: Partial<EvalContext> = {}): EvalContext {
    return {
      scope,
      worldState: this.worldStateService.getWorldState(),
      clock: this.worldStateService.getClock(),
      reminders: this.worldStateService.getReminders(),
      model,
      pendingOverlayWrites: [],
      triggeredEvents: new Set(),
      firedReminders: [],
      events: [],
      ...extras,
    };
  }

  private flushPendingWrites(ctx: EvalContext): void {
    for (const w of ctx.pendingOverlayWrites ?? []) {
      this.worldStateService.setOverlayEntry(w.path, w.value);
    }
  }

  /** Encodes an interpreter-side event log (StatePath writes) into the wire shape
   *  (string paths) every command response shares, or undefined when nothing ran. */
  private encodeEvents(events: InterpreterEvent[]): ScriptEvent[] | undefined {
    return nonEmpty(events)?.map(e => e.kind === 'write' ? { ...e, path: encodeStatePath(e.path) } : e);
  }

  private applyCommand(cmd: Command): void {
    switch (cmd.type) {
      case 'ASSIGN_VARIABLE': this.applyAssignVariable(cmd); break;
      case 'ASSIGN_RUNTIME_VARIABLE': this.applyAssignRuntimeVariable(cmd); break;
      case 'ACK_REMINDER': this.applyAckReminder(cmd); break;
    }
  }

  private applyAckReminder(cmd: AckReminderCommand): void {
    if (!this.worldStateService.ackReminder(cmd.reminderId)) {
      throw new Error(`No fired reminder with id '${cmd.reminderId}' to acknowledge`);
    }
  }

  private applyAssignRuntimeVariable(cmd: AssignRuntimeVariableCommand): void {
    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};
    state.runtimeVariables[cmd.variableName] = cmd.newValue;
  }

  /**    
   *  If the leaf variable itself doesn't exist yet, that's not an error as long as its parent container does.
   *  ASSIGN_VARIABLE creates it in that case using WorldStateService.setOverlayEntry()
   **/
  private applyAssignVariable(cmd: AssignVariableCommand): void {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const node = statePathToNode(model, cmd.path);
    if (node) {
      if (!isVariableDeclaration(node)) {
        throw new Error(`Path does not point to a variable: ${JSON.stringify(cmd.path)}`);
      }
      if (node.isComputed === 'computed') {
        throw new Error(`Cannot assign to computed variable at path: ${JSON.stringify(cmd.path)}`);
      }
    } else if (!resolveVariableContainer(model, cmd.path)) {
      throw new Error(`Unresolved state path for ASSIGN_VARIABLE: ${JSON.stringify(cmd.path)}`);
    }

    this.worldStateService.setOverlayEntry(cmd.path, cmd.newValue);
  }

  private getRuntimeVariables(): Record<string, unknown> {
    return this.worldStateService.getWorldState().runtimeVariables ?? {};
  }

  private setRuntimeVariables(vars: Record<string, unknown>): void {
    this.worldStateService.getWorldState().runtimeVariables = vars;
  }

  private snapshotRuntimeState(): RuntimeStateSnapshot {
    return {
      overlay: structuredClone(this.worldStateService.getOverlay()),
      runtimeVars: structuredClone(this.getRuntimeVariables()),
      clock: this.worldStateService.getClock(),
      reminders: structuredClone(this.worldStateService.getReminders()),
      firedReminders: structuredClone(this.worldStateService.getFiredReminders()),
    };
  }

  private restoreRuntimeState(snapshot: RuntimeStateSnapshot): void {
    this.worldStateService.restoreOverlay(structuredClone(snapshot.overlay));
    this.setRuntimeVariables(structuredClone(snapshot.runtimeVars));
    this.worldStateService.setClock(snapshot.clock);
    this.worldStateService.setReminders(structuredClone(snapshot.reminders));
    this.worldStateService.setFiredReminders(structuredClone(snapshot.firedReminders));
  }

  private buildResponse(): CommandResponse {
    return {
      worldState: this.worldStateService.getWorldState(),
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
  }
}
