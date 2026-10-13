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

/** Built from names only, so it works for the live AST and the serialized worldState alike. */
export function questStatusPath(questName: string): StatePath {
    return [{ kind: "quest", name: questName }, { kind: "variable", target: STATUS_VARIABLE }];
}

export function objectiveStatusPath(questName: string, objectiveName: string): StatePath {
    return [{ kind: "objective", questName, name: objectiveName }, { kind: "variable", target: STATUS_VARIABLE }];
}

/**
 * `accept`, `complete` and `fail` are the explicit statements (`accept quest`,
 * `complete quest|objective`, `fail quest|objective`). `enable` has no statement: it is the
 * automatic Unavailable -> Available hop the interpreter takes when a quest's `enabled`
 * condition becomes true.
 */
export type StatusAction = "enable" | "accept" | "complete" | "fail";
export type StatusKind = "quest" | "objective";
/** Which of the entity's `on completed` / `on failed` blocks a transition runs. */
export type StatusBlock = "completed" | "failed";
export type StatusTransition = { to: string; runs?: StatusBlock };

type Rule<S extends string> = { from: S; to: S; runs?: StatusBlock };

const QUEST_RULES: Partial<Record<StatusAction, Rule<QuestStatusValue>>> = {
    enable: { from: "Unavailable", to: "Available" },
    accept: { from: "Available", to: "Started" },
    complete: { from: "Started", to: "Succeeded", runs: "completed" },
    fail: { from: "Started", to: "Failed", runs: "failed" },
};

const OBJECTIVE_RULES: Partial<Record<StatusAction, Rule<ObjectiveStatusValue>>> = {
    complete: { from: "Incomplete", to: "Completed", runs: "completed" },
    fail: { from: "Incomplete", to: "Failed", runs: "failed" },
};

/** A stored status, or the default when there is none (a value that is not a string means unseeded). */
export function statusOrDefault(kind: StatusKind, current: unknown): string {
    if (typeof current === "string") return current;
    return kind === "quest" ? DEFAULT_QUEST_STATUS : DEFAULT_OBJECTIVE_STATUS;
}

const STATUS_EXPRESSIONS = {
    QuestCompletedExpression: { kind: "quest", holds: (s: string) => s === "Succeeded" },
    QuestFailedExpression: { kind: "quest", holds: (s: string) => s === "Failed" },
    // Crossed `accept` at all, whatever became of the quest since.
    QuestAcceptedExpression: { kind: "quest", holds: (s: string) => s !== "Unavailable" && s !== "Available" },
    ObjectiveCompletedExpression: { kind: "objective", holds: (s: string) => s === "Completed" },
    ObjectiveFailedExpression: { kind: "objective", holds: (s: string) => s === "Failed" },
} as const;

export type StatusExpressionType = keyof typeof STATUS_EXPRESSIONS;

export function isStatusExpressionType(type: unknown): type is StatusExpressionType {
    return typeof type === "string" && Object.prototype.hasOwnProperty.call(STATUS_EXPRESSIONS, type);
}

/** `quest completed "A"` and the other four forms, given the target's current status (or none yet). */
export function statusExpressionHolds(type: StatusExpressionType, current: unknown): boolean {
    const rule = STATUS_EXPRESSIONS[type];
    return rule.holds(statusOrDefault(rule.kind, current));
}

/**
 * What `action` does to something currently at `current`, or `undefined` when it does not
 * apply (`accept` on a quest that is not Available, anything on a finished quest, ...).
 * Callers treat `undefined` as a silent no-op, so a script can call these defensively.
 */
export function statusTransition(kind: StatusKind, action: StatusAction, current: unknown): StatusTransition | undefined {
    const rule = (kind === "quest" ? QUEST_RULES : OBJECTIVE_RULES)[action];
    if (!rule || rule.from !== statusOrDefault(kind, current)) return undefined;
    return { to: rule.to, runs: rule.runs };
}

/**
 * The block a quest or objective runs on arriving at `status`: `on completed` for Succeeded
 * (quest) or Completed (objective), `on failed` for Failed, none for the rest. The same
 * outcome whether it got there by a statement, the automatic pass, or `set`.
 */
export function statusBlockFor(kind: StatusKind, status: string): StatusBlock | undefined {
    const rules: Partial<Record<StatusAction, Rule<string>>> = kind === "quest" ? QUEST_RULES : OBJECTIVE_RULES;
    return Object.values(rules).find(rule => rule?.to === status && rule.runs)?.runs;
}

/**
 * Throws when `value` is not a legal status for the quest or objective `path` addresses, and does
 * nothing for any other path. Every write goes through this (the interpreter's `set`, a UI
 * assignment), so an out-of-range value can never be stored: the transition rules read it as
 * "from nothing", which would leave the quest stuck.
 */
export function assertValidStatusWrite(path: StatePath, value: unknown): void {
    const [owner, variable] = path;
    if (path.length !== 2 || variable.kind !== "variable" || variable.target !== STATUS_VARIABLE) return;
    if (owner.kind !== "quest" && owner.kind !== "objective") return;

    const allowed: readonly string[] = owner.kind === "quest" ? QUEST_STATUSES : OBJECTIVE_STATUSES;
    if (typeof value === "string" && allowed.includes(value)) return;
    throw new Error(`${JSON.stringify(value)} is not a ${owner.kind} status. Use one of: ${allowed.join(", ")}.`);
}
