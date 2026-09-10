import { Injectable } from '@nestjs/common';
import { WorldStateService } from '../world-state/world-state.service.js';
import { LangiumInterpreterService, type EvalContext } from '../langium-interpreter/langium-interpreter.service.js';

import { isVariableDeclaration } from '@dnd-language/index.js';
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
  TriggerEventCommand,
} from '@dnd-language/evaluation/dnd-dsl-commands.js';

/** Everything that must roll back together on undo, or be restored verbatim on redo
 *  of a non-deterministic command. Widened beyond overlay/runtimeVars to also cover
 *  clock/reminders once RemindStatement made those mutable from any function/event body. */
type RuntimeStateSnapshot = {
  overlay: Record<string, unknown>;
  runtimeVars: Record<string, unknown>;
  clock: number;
  reminders: ScheduledReminder[];
  firedReminders: FiredReminder[];
};

const nonEmpty = (fired: FiredReminder[]): FiredReminder[] | undefined => (fired.length ? fired : undefined);

type HistoryEntry = {
  command: Command;
  previous: RuntimeStateSnapshot;
  /** Only captured for CALL_FUNCTION/TRIGGER_EVENT/ADVANCE_TIME. Lets redo restore the
   *  exact post-execution result instead of re-running the interpreter, which could be
   *  non-deterministic (e.g. a predefined random function). Every other command
   *  type is pure/deterministic, so its redo just reapplies the command instead. */
  post?: RuntimeStateSnapshot;
};

@Injectable()
export class CommandService {
  private readonly history: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(
    private readonly worldStateService: WorldStateService,
    private readonly interpreterService: LangiumInterpreterService,
  ) {}

  async execute(cmd: Command): Promise<CommandResponse> {
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

  undo(): CommandResponse {
    const entry = this.history.pop();
    if (entry) {
      this.future.unshift(entry);
      this.restoreRuntimeState(entry.previous);
      this.worldStateService.persistOverlay();
    }
    return this.buildResponse();
  }

  redo(): CommandResponse {
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
    return this.buildResponse();
  }

  private executeCallFunction(cmd: CallFunctionCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();

    const state = this.worldStateService.getWorldState();
    const ctx: EvalContext = {
      scope: { ...(state.runtimeVariables ?? {}) },
      worldState: state,
      clock: this.worldStateService.getClock(),
      reminders: this.worldStateService.getReminders(),
      firedReminders: [],
    };
    const result = this.interpreterService.callFunctionByName(model, cmd.functionName, cmd.args, ctx);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return { ...this.buildResponse(), result, firedReminders: nonEmpty(ctx.firedReminders!) };
  }

  private executeTriggerEvent(cmd: TriggerEventCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();

    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};

    // Pass runtimeVariables directly so in-place mutations from VariableAssignment
    // and VariableDeclaration statements inside the event body persist.
    const ctx: EvalContext = {
      scope: state.runtimeVariables,
      worldState: state,
      clock: this.worldStateService.getClock(),
      reminders: this.worldStateService.getReminders(),
      firedReminders: [],
    };
    this.interpreterService.triggerEventByName(model, cmd.eventName, ctx);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return { ...this.buildResponse(), firedReminders: nonEmpty(ctx.firedReminders!) };
  }

  private executeAdvanceTime(cmd: AdvanceTimeCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previous = this.snapshotRuntimeState();
    const justFired = this.worldStateService.advanceClock(durationToRounds(cmd.amount, cmd.unit));

    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};
    const firedFromBodies: FiredReminder[] = [];
    for (const reminder of justFired) {
      if (!reminder.bodyLocator) continue;
      const codeBlock = resolveRemindBodyLocator(model, reminder.bodyLocator);
      if (!codeBlock) {
        console.warn(`Reminder '${reminder.id}' effect body no longer resolves - skipping.`);
        continue;
      }
      const ctx: EvalContext = {
        scope: state.runtimeVariables,
        worldState: state,
        clock: this.worldStateService.getClock(),
        reminders: this.worldStateService.getReminders(),
        firedReminders: firedFromBodies,
      };
      try {
        this.interpreterService.runCodeBlock(ctx, codeBlock);
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

    return { ...this.buildResponse(), firedReminders: [...justFired, ...firedFromBodies] };
  }

  /** Parses + links the script against the loaded world, runs it in isolation
   *  (scope/reminders are copies, entity writes are deferred), then commits
   *  everything as one HistoryEntry. A parse or runtime failure commits nothing. */
  private async executeRunScript(cmd: RunScriptCommand): Promise<CommandResponse> {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No world is loaded');

    const previous = this.snapshotRuntimeState();

    const { codeBlock, errors } = await this.worldStateService.parseScript(cmd.source);
    if (errors.length || !codeBlock) {
      throw new Error(errors.map(e => `line ${e.line + 1}: ${e.message}`).join('\n') || 'Empty script');
    }

    const state = this.worldStateService.getWorldState();
    const ctx: EvalContext = {
      scope: { ...(state.runtimeVariables ?? {}) },
      worldState: state,
      clock: this.worldStateService.getClock(),
      reminders: structuredClone(this.worldStateService.getReminders()),
      model,
      pendingOverlayWrites: [],
      triggeredEvents: new Set(),
      firedReminders: [],
      printed: [],
    };

    let returnValue: unknown;
    try {
      returnValue = this.interpreterService.runScript(ctx, codeBlock);
    } catch (e) {
      throw new Error(`Script failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    state.runtimeVariables = ctx.scope;
    this.worldStateService.setReminders(ctx.reminders);
    this.worldStateService.addFiredReminders(ctx.firedReminders!);
    for (const w of ctx.pendingOverlayWrites!) {
      this.worldStateService.setOverlayEntry(w.path, w.value);
    }

    const post = this.snapshotRuntimeState();
    this.history.push({ command: cmd, previous, post });
    this.future.splice(0);
    this.worldStateService.persistOverlay();

    return {
      ...this.buildResponse(),
      firedReminders: nonEmpty(ctx.firedReminders!),
      scriptResult: {
        returnValue,
        printedValue: ctx.printed!,
        writes: ctx.pendingOverlayWrites!.map(w => ({ path: encodeStatePath(w.path), value: w.value })),
      },
    };
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

  /** The client explicitly asked to assign to a specific path, so — unlike the state
   *  overlay's own load-time merge, which treats an unresolved path as recoverable —
   *  an unresolved or computed target here is a real error the client needs to see.
   *
   *  If the leaf variable itself doesn't exist yet, that's not an error as long as its
   *  parent container does (a real Location/Quest/etc, or an already-declared `object`
   *  block) — ASSIGN_VARIABLE creates it in that case. WorldStateService.setOverlayEntry
   *  does the actual creation (see spliceOverlayValue), since that logic also has to run
   *  on every rebuild (undo/redo/restart), not just here. */
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
