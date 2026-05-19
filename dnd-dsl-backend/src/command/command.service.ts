import { Injectable } from '@nestjs/common';
import { WorldStateService } from '../world-state/world-state.service.js';
import { LangiumInterpreterService } from '../langium-interpreter/langium-interpreter.service.js';

import { parseReferenceFromModel } from '@dnd-language/evaluation/dnd-dsl-reference.js';
import { Model } from '@dnd-language/index.js';
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
  /** Deep-cloned snapshot of worldState before this command was applied */
  previousState: any;
};


// ─── Command handlers (operate on a deep-cloned state copy) ──────────────────

function applySimulateDay(state: Model, _cmd: SimulateDayCommand): any {
  // TODO: implement day tick — evaluate events, tick quests, apply resource changes
  console.log(`Simulating day ${_cmd.dayNumber}`);
  return state;
}

function applyAssignRuntimeVariable(state: any, cmd: AssignRuntimeVariableCommand): any {
  state.runtimeVariables ??= {};
  state.runtimeVariables[cmd.variableName] = cmd.newValue;
  return state;
}

function applyAssignVariable(state: any, cmd: AssignVariableCommand): any {
  const ref: any = parseReferenceFromModel(state, cmd);
  if (!ref) return state;
  const variable = (ref.variables ?? []).find((v: any) => v.target === cmd.variableName);
  if (!variable) return state;
  variable.value = cmd.newValue;
  return state;
}



@Injectable()
export class CommandService {
  private readonly history: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(
    private readonly worldStateService: WorldStateService,
    private readonly interpreterService: LangiumInterpreterService,
  ) {}

  execute(cmd: Command): CommandResponse {
    if (cmd.type === 'CALL_FUNCTION') {
      return this.executeCallFunction(cmd);
    }
    else if (cmd.type === 'TRIGGER_EVENT') {
      return this.executeTriggerEvent(cmd);
    }

    const previousState = structuredClone(this.worldStateService.getWorldState());
    const updated = this.applyCommand(cmd, structuredClone(previousState));
    this.worldStateService.setWorldState(updated);
    this.history.push({ command: cmd, previousState });
    this.future.splice(0);
    return this.buildResponse();
  }

  undo(): CommandResponse {
    const entry = this.history.pop();
    if (entry) {
      this.future.unshift(entry);
      this.worldStateService.setWorldState(structuredClone(entry.previousState));
    }
    return this.buildResponse();
  }

  redo(): CommandResponse {
    const entry = this.future.shift();
    if (entry) {
      if (entry.command.type === 'CALL_FUNCTION' || entry.command.type === 'TRIGGER_EVENT') return this.buildResponse();
      const previousState = structuredClone(this.worldStateService.getWorldState());
      const updated = this.applyCommand(entry.command, structuredClone(this.worldStateService.getWorldState()));
      this.worldStateService.setWorldState(updated);
      this.history.push({ command: entry.command, previousState });
    }
    return this.buildResponse();
  }

  private executeCallFunction(cmd: CallFunctionCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const state = this.worldStateService.getWorldState();
    const scope = { ...(state.runtimeVariables ?? {}) };

    const result = this.interpreterService.callFunctionByName(model, cmd.functionName, cmd.args, scope);

    return { ...this.buildResponse(), result };
  }

  private executeTriggerEvent(cmd: TriggerEventCommand): CommandResponse {
    const model = this.worldStateService.getModel();
    if (!model) throw new Error('No model loaded');

    const state = this.worldStateService.getWorldState();
    const scope = { ...(state.runtimeVariables ?? {}) };

    this.interpreterService.triggerEventByName(model, cmd.eventName, scope);

    return { ...this.buildResponse() };
  }

  private applyCommand(cmd: Command, state: Model): Model {
    switch (cmd.type) {
      case 'SIMULATE_DAY':    return applySimulateDay(state, cmd);
      case 'ASSIGN_VARIABLE': return applyAssignVariable(state, cmd);
      case 'ASSIGN_RUNTIME_VARIABLE': return applyAssignRuntimeVariable(state, cmd);

      default: return state;
    }
  }

  private buildResponse(): CommandResponse {
    return {
      worldState: this.worldStateService.getWorldState(),
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
  }
}
