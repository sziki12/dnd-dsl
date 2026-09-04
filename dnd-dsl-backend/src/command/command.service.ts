import { Injectable } from '@nestjs/common';
import { WorldStateService } from '../world-state/world-state.service.js';
import { LangiumInterpreterService, type EvalContext } from '../langium-interpreter/langium-interpreter.service.js';

import { isVariableDeclaration } from '@dnd-language/index.js';
import { resolveVariableContainer, statePathToNode } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import {
  AssignRuntimeVariableCommand,
  AssignVariableCommand,
  CallFunctionCommand,
  Command,
  CommandResponse,
  SimulateDayCommand,
  TriggerEventCommand,
} from '@dnd-language/evaluation/dnd-dsl-commands.js';

type HistoryEntry = {
  command: Command;
  previousOverlay: Record<string, unknown>;
  previousRuntimeVars: Record<string, unknown>;
  /** Only captured for CALL_FUNCTION/TRIGGER_EVENT. Lets redo restore the exact
   *  post-execution result instead of re-running the interpreter, which could be
   *  non-deterministic (e.g. a predefined random function). Every other command
   *  type is pure/deterministic, so its redo just reapplies the command instead. */
  postOverlay?: Record<string, unknown>;
  postRuntimeVars?: Record<string, unknown>;
};

@Injectable()
export class CommandService {
  private readonly history: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(
    private readonly worldStateService: WorldStateService,
    private readonly interpreterService: LangiumInterpreterService,
  ) {}

  execute(cmd: Command): CommandResponse {
    if (cmd.type === 'CALL_FUNCTION') return this.executeCallFunction(cmd);
    if (cmd.type === 'TRIGGER_EVENT') return this.executeTriggerEvent(cmd);

    const previousOverlay = structuredClone(this.worldStateService.getOverlay());
    const previousRuntimeVars = structuredClone(this.getRuntimeVariables());
    this.applyCommand(cmd);
    this.worldStateService.persistOverlay();
    this.history.push({ command: cmd, previousOverlay, previousRuntimeVars });
    this.future.splice(0);
    return this.buildResponse();
  }

  undo(): CommandResponse {
    const entry = this.history.pop();
    if (entry) {
      this.future.unshift(entry);
      this.worldStateService.restoreOverlay(structuredClone(entry.previousOverlay));
      this.setRuntimeVariables(structuredClone(entry.previousRuntimeVars));
      this.worldStateService.persistOverlay();
    }
    return this.buildResponse();
  }

  redo(): CommandResponse {
    const entry = this.future.shift();
    if (entry) {
      if (entry.postOverlay) {
        this.worldStateService.restoreOverlay(structuredClone(entry.postOverlay));
        this.setRuntimeVariables(structuredClone(entry.postRuntimeVars ?? {}));
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

    const previousOverlay = structuredClone(this.worldStateService.getOverlay());
    const previousRuntimeVars = structuredClone(this.getRuntimeVariables());

    const state = this.worldStateService.getWorldState();
    const ctx: EvalContext = { scope: { ...(state.runtimeVariables ?? {}) }, worldState: state };
    const result = this.interpreterService.callFunctionByName(model, cmd.functionName, cmd.args, ctx);

    const postOverlay = structuredClone(this.worldStateService.getOverlay());
    const postRuntimeVars = structuredClone(this.getRuntimeVariables());

    this.history.push({ command: cmd, previousOverlay, previousRuntimeVars, postOverlay, postRuntimeVars });
    this.future.splice(0);

    return { ...this.buildResponse(), result };
  }

  private executeTriggerEvent(cmd: TriggerEventCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const previousOverlay = structuredClone(this.worldStateService.getOverlay());
    const previousRuntimeVars = structuredClone(this.getRuntimeVariables());

    const state = this.worldStateService.getWorldState();
    state.runtimeVariables ??= {};

    // Pass runtimeVariables directly so in-place mutations from VariableAssignment
    // and VariableDeclaration statements inside the event body persist.
    const ctx: EvalContext = { scope: state.runtimeVariables, worldState: state };
    this.interpreterService.triggerEventByName(model, cmd.eventName, ctx);

    const postOverlay = structuredClone(this.worldStateService.getOverlay());
    const postRuntimeVars = structuredClone(this.getRuntimeVariables());

    this.history.push({ command: cmd, previousOverlay, previousRuntimeVars, postOverlay, postRuntimeVars });
    this.future.splice(0);

    return this.buildResponse();
  }

  private applyCommand(cmd: Command): void {
    switch (cmd.type) {
      case 'SIMULATE_DAY': this.applySimulateDay(cmd); break;
      case 'ASSIGN_VARIABLE': this.applyAssignVariable(cmd); break;
      case 'ASSIGN_RUNTIME_VARIABLE': this.applyAssignRuntimeVariable(cmd); break;
    }
  }

  private applySimulateDay(cmd: SimulateDayCommand): void {
    // TODO: implement day tick — evaluate events, tick quests, apply resource changes
    console.log(`Simulating day ${cmd.dayNumber}`);
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

  private buildResponse(): CommandResponse {
    return {
      worldState: this.worldStateService.getWorldState(),
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
  }
}
