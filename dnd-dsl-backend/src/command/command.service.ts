import { Injectable } from '@nestjs/common';
import { WorldStateService } from '../world-state/world-state.service.js';

import { parseReferenceFromModel } from '@dnd-language/evaluation/dnd-dsl-reference.js';
import { Model } from '@dnd-language/index.js';
import { AstNode } from 'langium';
import { 
  Command, 
  CommandResponse,
  SetVariableCommand,
  SimulateDayCommand 
} from '@dnd-language/evaluation/dnd-dsl-commands.js';

type HistoryEntry =   {
  command: Command;
  /** Deep-cloned snapshot of worldState before this command was applied */
  previousState: any;
};


// ─── Command handlers (operate on a deep-cloned state copy) ──────────────────

function applySetVariable(state: Model, cmd: SetVariableCommand): any {
  const ref: any = parseReferenceFromModel(state, cmd);
  if (!ref) return state;
  const variable = (ref.variables ?? []).find((v: any) => v.target === cmd.variableName);
  if (!variable) return state;
  variable.value = cmd.newValue;
  return state;
}

function applySimulateDay(state: Model, _cmd: SimulateDayCommand): any {
  // TODO: implement day tick — evaluate events, tick quests, apply resource changes
  console.log(`Simulating day ${_cmd.dayNumber}`);
  return state;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CommandService {
  private readonly history: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(private readonly worldStateService: WorldStateService) {}

  execute(cmd: Command): CommandResponse {
    const previousState = structuredClone(this.worldStateService.getWorldState());
    const updated = this.applyCommand(cmd, structuredClone(previousState));
    this.worldStateService.setWorldState(updated);
    this.history.push({ command: cmd, previousState });
    this.future.splice(0); // clear redo stack
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
      const previousState = structuredClone(this.worldStateService.getWorldState());
      const updated = this.applyCommand(entry.command, structuredClone(this.worldStateService.getWorldState()));
      this.worldStateService.setWorldState(updated);
      this.history.push({ command: entry.command, previousState });
    }
    return this.buildResponse();
  }

  private applyCommand(cmd: Command, state: Model): Model {
    switch (cmd.type) {
      case 'SET_VARIABLE': return applySetVariable(state, cmd);
      case 'SIMULATE_DAY':  return applySimulateDay(state, cmd);
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
