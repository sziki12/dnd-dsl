import type { SerializedModel, SerializedVariableDecl } from "./dnd-dsl-serialized-types.js";
import type { StatePath } from "./dnd-dsl-state-path.js";

/** 
 *  The variable a quest/objective's status is stored under.
 **/
export const STATUS_VARIABLE = "Status";

export const QUEST_STATUSES = ["Unavailable", "Available", "Started", "Succeeded", "Failed"] as const;
export const OBJECTIVE_STATUSES = ["Incomplete", "Completed", "Failed"] as const;

export type QuestStatusValue = (typeof QUEST_STATUSES)[number];
export type ObjectiveStatusValue = (typeof OBJECTIVE_STATUSES)[number];

export const DEFAULT_QUEST_STATUS: QuestStatusValue = "Unavailable";
export const DEFAULT_OBJECTIVE_STATUS: ObjectiveStatusValue = "Incomplete";

/**
 * Gives every quest and objective a `Status` variable at its default value, unless it already has a variable of that name.
 *
 * Runs on the served worldState only, before the overlay is applied. Never on the overlay itself. 
 * That keeps the defaults derived rather than stored. 
 * A later overlay write to the same path then splices into this entry like any other variable.
 */
export function seedStatusDefaults(model: SerializedModel): void {
    for (const quest of model.World?.quests ?? []) {
        quest.variables ??= [];
        ensureStatus(quest.variables, DEFAULT_QUEST_STATUS);
        for (const objective of quest.objectives ?? []) {
            objective.variables ??= [];
            ensureStatus(objective.variables, DEFAULT_OBJECTIVE_STATUS);
        }
    }
}

function ensureStatus(variables: SerializedVariableDecl[], defaultValue: string): void {
    if (variables.some(v => (v.target ?? v.name) === STATUS_VARIABLE)) return;
    // A raw value rather than an Expression node, the same shape
    // WorldStateService.spliceOverlayValue already pushes for an overlay-created variable.
    variables.push({ $type: "VariableDeclaration", target: STATUS_VARIABLE, value: defaultValue } as unknown as SerializedVariableDecl);
}

/** Built from names only, so it works for the live AST and the serialized worldState alike. */
export function questStatusPath(questName: string): StatePath {
    return [{ kind: "quest", name: questName }, { kind: "variable", target: STATUS_VARIABLE }];
}

export function objectiveStatusPath(questName: string, objectiveName: string): StatePath {
    return [{ kind: "objective", questName, name: objectiveName }, { kind: "variable", target: STATUS_VARIABLE }];
}

/** The three explicit statements: `accept quest`, `complete quest|objective`, `fail quest|objective`. */
export type StatusAction = "accept" | "complete" | "fail";
export type StatusKind = "quest" | "objective";
/** Which of the entity's `on completed` / `on failed` blocks a transition runs. */
export type StatusBlock = "completed" | "failed";
export type StatusTransition = { to: string; runs?: StatusBlock };

type Rule<S extends string> = { from: S; to: S; runs?: StatusBlock };

const QUEST_RULES: Partial<Record<StatusAction, Rule<QuestStatusValue>>> = {
    accept: { from: "Available", to: "Started" },
    complete: { from: "Started", to: "Succeeded", runs: "completed" },
    fail: { from: "Started", to: "Failed", runs: "failed" },
};

const OBJECTIVE_RULES: Partial<Record<StatusAction, Rule<ObjectiveStatusValue>>> = {
    complete: { from: "Incomplete", to: "Completed", runs: "completed" },
    fail: { from: "Incomplete", to: "Failed", runs: "failed" },
};

/**
 * What `action` does to something currently at `current`, or `undefined` when it does not
 * apply (`accept` on a quest that is not Available, anything on a finished quest, ...).
 * Callers treat `undefined` as a silent no-op, so a script can call these defensively.
 * A `current` that is not a string (an unseeded context) counts as the default status.
 */
export function statusTransition(kind: StatusKind, action: StatusAction, current: unknown): StatusTransition | undefined {
    const rule = (kind === "quest" ? QUEST_RULES : OBJECTIVE_RULES)[action];
    const status = typeof current === "string"
        ? current
        : kind === "quest" ? DEFAULT_QUEST_STATUS : DEFAULT_OBJECTIVE_STATUS;
    if (!rule || rule.from !== status) return undefined;
    return { to: rule.to, runs: rule.runs };
}
