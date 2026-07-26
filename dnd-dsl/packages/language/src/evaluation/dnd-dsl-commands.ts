/** This file defines the shape of commands that can be issued to the DnD DSL interpreter. */


export type SimulateDayCommand = {
  type: 'SIMULATE_DAY';
  dayNumber: number;
};

/** Assign a value to a named variable in the interpreter runtime scope. */
export type AssignRuntimeVariableCommand = {
  type: 'ASSIGN_RUNTIME_VARIABLE';
  variableName: string;
  newValue: any;
};

/** Assign a value to a named variable in the interpreter runtime scope. */
export type AssignVariableCommand = {
  type: 'ASSIGN_VARIABLE';
  $ref: string;
  variableName: string;
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
  | SimulateDayCommand
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
};