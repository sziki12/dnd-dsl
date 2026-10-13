import type {
    SerializedEvent,
    SerializedModel,
    SerializedObjective,
    SerializedQuest,
    SerializedRef,
    SerializedVariableDecl,
} from "./dnd-dsl-serialized-types.js";
import { parseReferenceFromSerializedModel } from "./dnd-dsl-reference.js";
import { evaluateSerializedExpression } from "./dnd-dsl-value-evaluator.js";
import { isStatusExpressionType, STATUS_VARIABLE, type StatusExpressionType } from "./dnd-dsl-status.js";

// Pure reads over the served worldState, for the Events and Quests pages. Browser-safe like
// the other evaluation files: no Langium runtime imports.

type Tagged = { $type: string };

/** Calls `visit` on every tagged node in a serialized subtree, depth first, in the order they were parsed. */
function visitNodes(value: unknown, visit: (node: Tagged) => void): void {
    if (Array.isArray(value)) {
        for (const item of value) visitNodes(item, visit);
        return;
    }
    if (typeof value !== "object" || value === null) return;
    if ("$type" in value) visit(value as Tagged);
    for (const child of Object.values(value)) visitNodes(child, visit);
}

/** The reference a quest-ish node's `target` (QuestRef, ObjectiveRef, EventRef) points through, if it resolved. */
function targetRef(node: Tagged): SerializedRef | undefined {
    const ref = (node as unknown as { target?: { val?: SerializedRef } }).target?.val;
    return ref?.$ref ? ref : undefined;
}

/**
 * Names of the events an event triggers directly, each once, in the order they appear. Looks
 * through nested `when`/`for`/`remind` bodies, but only in the event's own body: not into
 * functions it calls, and not into `on ...` handlers hosted on it (those are reactions
 * to something else, not what this event does).
 */
export function triggeredEventNames(model: SerializedModel, event: SerializedEvent): string[] {
    const names: string[] = [];
    visitNodes(event.codeBlock, node => {
        if (node.$type !== "EventTrigger") return;
        const ref = targetRef(node);
        const name = ref && parseReferenceFromSerializedModel<SerializedEvent>(model, ref)?.name;
        if (name && !names.includes(name)) names.push(name);
    });
    return names;
}

export type QuestDependency = {
    /** What the expression looks at: `quest completed "A"` is a quest, `objective failed "B"` an objective. */
    target: "quest" | "objective";
    name: string;
    /** The quest to link to: the quest itself, or the one that owns the objective. */
    quest: string;
    requires: "completed" | "failed" | "accepted";
};

const REQUIRES: Record<StatusExpressionType, QuestDependency["requires"]> = {
    QuestCompletedExpression: "completed",
    QuestFailedExpression: "failed",
    QuestAcceptedExpression: "accepted",
    ObjectiveCompletedExpression: "completed",
    ObjectiveFailedExpression: "failed",
};

/**
 * The quests and objectives a condition (a quest's `enabled` or `requierement`) waits on, each
 * once, in order. Only the five `quest ...` / `objective ...` forms count; any other
 * part of the condition (a variable comparison, say) is not a dependency on another quest.
 */
export function questDependencies(model: SerializedModel, condition: unknown): QuestDependency[] {
    const found: QuestDependency[] = [];
    visitNodes(condition, node => {
        if (!isStatusExpressionType(node.$type)) return;
        const ref = targetRef(node);
        if (!ref) return;
        const target = node.$type.startsWith("Quest") ? "quest" : "objective";
        const entity = parseReferenceFromSerializedModel<SerializedQuest | SerializedObjective>(model, ref);
        if (!entity) return;
        const quest = target === "quest"
            ? entity.name
            : model.World.quests.find(q => q.objectives.includes(entity as SerializedObjective))?.name;
        if (!quest) return;
        const dependency: QuestDependency = { target, name: entity.name, quest, requires: REQUIRES[node.$type] };
        if (!found.some(d => d.target === dependency.target && d.name === dependency.name && d.requires === dependency.requires)) {
            found.push(dependency);
        }
    });
    return found;
}

/** A quest's or objective's current `Status` ("Started", "Completed", ...), or undefined if it has none. */
export function statusOf(model: SerializedModel, entity: { variables?: SerializedVariableDecl[] }): string | undefined {
    const variable = entity.variables?.find(v => (v.target ?? v.name) === STATUS_VARIABLE);
    const value = variable && evaluateSerializedExpression(model, variable.value);
    return typeof value === "string" ? value : undefined;
}
