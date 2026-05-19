export type SerializedRef = { $ref: string };

export type SetVariableCommand = {
  type: 'SET_VARIABLE';
  $ref: string;
  variableName: string;
  /** Full SerializedNode<Expression> replacement value */
  newValue: any;
};

export type SimulateDayCommand = {
  type: 'SIMULATE_DAY';
  dayNumber: number;
};

export type Command =
  | SetVariableCommand
  | SimulateDayCommand;

export type CommandResponse = {
  worldState: any;
  canUndo: boolean;
  canRedo: boolean;
};
