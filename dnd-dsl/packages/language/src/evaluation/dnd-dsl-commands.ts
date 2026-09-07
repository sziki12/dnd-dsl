/** This file defines the shape of commands that can be issued to the DnD DSL interpreter. */

import type { ClockUnit } from './dnd-dsl-clock.js';
import type { FiredReminder } from './dnd-dsl-reminders.js';
import type { StatePath } from './dnd-dsl-state-path.js';

/** Advances the world clock and fires any reminder now due. Replaces the old
 *  SIMULATE_DAY command, which had no dispatch site anywhere and was never
 *  reachable from any client. */
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
 *  stable name-based path rather than a positional $ref — see dnd-dsl-state-path.ts. */
export type AssignVariableCommand = {
  type: 'ASSIGN_VARIABLE';
  path: StatePath;
  newValue: any;
};

/**
 * Execute a named DSL function through the interpreter.
 * The return value is surfaced in CommandResponse.result.
 * The runtime scope is passed as the function's initial scope
 * so previously assigned variables are visible inside the body.
 */
export type CallFunctionCommand = {
  type: 'CALL_FUNCTION';
  functionName: string;
  args: any[];
};

export type TriggerEventCommand = {
  type: 'TRIGGER_EVENT';
  eventName: string;
};

export type Command =
  | AdvanceTimeCommand
  | AckReminderCommand
  | AssignVariableCommand
  | AssignRuntimeVariableCommand
  | CallFunctionCommand
  | TriggerEventCommand;

export type CommandResponse = {
  worldState: any;
  canUndo: boolean;
  canRedo: boolean;
  /** Return value produced by a CallFunctionCommand, undefined otherwise. */
  result?: any;
  /** Reminders that fired during an AdvanceTimeCommand, undefined otherwise. */
  firedReminders?: FiredReminder[];
};