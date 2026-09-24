/** This file defines the shape of commands that can be issued to the DnD DSL interpreter. */

import type { ClockUnit } from './dnd-dsl-clock.js';
import type { FiredReminder } from './dnd-dsl-reminders.js';
import type { StatePath } from './dnd-dsl-state-path.js';

/** Advances the world clock and fires any reminder now due*/
export type AdvanceTimeCommand = {
  type: 'ADVANCE_TIME';
  amount: number;
  unit: ClockUnit;
};

/** Removes one fired reminder from the needs-acknowledgement list. */
export type AckReminderCommand = {
  type: 'ACK_REMINDER';
  reminderId: string;
};

/** Assign a value to a named variable in the interpreter runtime scope. */
export type AssignRuntimeVariableCommand = {
  type: 'ASSIGN_RUNTIME_VARIABLE';
  variableName: string;
  newValue: any;
};

/** Assign a value to a declared (non-computed) `let` variable, addressed by its
 *  stable name-based path rather than a positional $ref*/
export type AssignVariableCommand = {
  type: 'ASSIGN_VARIABLE';
  path: StatePath;
  newValue: any;
};

/**
 *  Execute a named DSL function through the interpreter
 *  The return value is visible in CommandResponse.result
 */
export type CallFunctionCommand = {
  type: 'CALL_FUNCTION';
  functionName: string;
  args: any[];
};

/** Trigger a named event through the interpreter 
 *  Its whole effect folds into one HistoryEntry.
*/
export type TriggerEventCommand = {
  type: 'TRIGGER_EVENT';
  eventName: string;
};

/** 
 *  Run a script against the loaded world + overlay. 
 *  Its whole effect folds into one HistoryEntry. 
 **/
export type RunScriptCommand = {
  type: 'RUN_SCRIPT';
  source: string;
};

export type Command =
  | AdvanceTimeCommand
  | AckReminderCommand
  | AssignVariableCommand
  | AssignRuntimeVariableCommand
  | CallFunctionCommand
  | TriggerEventCommand
  | RunScriptCommand;

/** One observable effect of running a command's code, in the order it executed: 
 *  a `print`,
 *  a persistent write,
 *  or a nested `trigger`
 *
 *  `depth` is how many trigger bodies are currently running
 *  0 outside any trigger,
 *  1 inside a top-level `trigger`'s body,
 *  2 inside a trigger fired from within that body, etc.
 *  A trigger event's own `depth` is the level it *opens*, so an event
 *  belongs inside the most recent preceding trigger whose depth is one less. 
 **/
export type ScriptEvent =
  | { kind: 'print'; value: unknown; depth: number }
  | { kind: 'write'; path: string; value: unknown; depth: number }
  | { kind: 'trigger'; eventName: string; depth: number };

export type CommandResponse = {
  worldState: any;
  canUndo: boolean;
  canRedo: boolean;
  /** Return value produced by a CallFunctionCommand, undefined otherwise */
  result?: any;
  /** 
   *  Reminders that fired while running this command. 
   *  Undefined when none fired. 
   **/
  firedReminders?: FiredReminder[];
  /** 
   *  print/write/trigger effects from running this command's code, in the order they were executed.
   **/
  events?: ScriptEvent[];
  /** 
   * Outcome of a RunScriptCommand, undefined otherwise.
   * To support later implemented nested script calls.
   */
  scriptResult?: {
    returnValue?: unknown;
  };
};