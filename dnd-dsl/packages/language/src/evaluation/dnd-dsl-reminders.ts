import type { AstNode } from "langium";
import type { CodeBlock, ConditionalBlock, Event, FunctionDeclaration, Model, RemindStatement } from "../generated/ast.js";
import type { StatePath } from "./dnd-dsl-state-path.js";

export type ReminderSeverity = 'info' | 'warning' | 'urgent';

/**
 * Addresses a RemindStatement's optional effect body by name + position instead of by
 * live AST reference, so it can be persisted and resolved again after a process restart
 * or a fresh /parse - a live CodeBlock reference can't survive either.
 */
export type RemindBodyLocator = {
    ownerKind: 'function' | 'event';
    ownerName: string;
    index: number;
};

export type ScheduledReminder = {
    id: string;
    label: string;
    severity: ReminderSeverity;
    createdAtRound: number;
    fireAtRound: number;
    pin?: StatePath;
    bodyLocator?: RemindBodyLocator;
};

export type FiredReminder = Omit<ScheduledReminder, 'fireAtRound'> & {
    firedAtRound: number;
    effectRan: boolean;
};

/** Depth-first list of every RemindStatement reachable from codeBlock, recursing into
 *  ConditionalBlock.body - the same traversal LangiumInterpreterService.runCodeBlock
 *  already performs. Order is stable as long as the source isn't edited before the
 *  matched statement, which is what makes computeRemindBodyLocator/resolveRemindBodyLocator
 *  a symmetric pair. */
export function collectRemindStatements(codeBlock: CodeBlock): RemindStatement[] {
    const result: RemindStatement[] = [];
    for (const code of codeBlock.code) {
        if (code.$type === 'RemindStatement') {
            result.push(code as RemindStatement);
        } else if (code.$type === 'ConditionalBlock') {
            for (const block of (code as ConditionalBlock).body) {
                result.push(...collectRemindStatements(block));
            }
        }
    }
    return result;
}

function findRemindOwner(stmt: RemindStatement):
    | { kind: 'function'; node: FunctionDeclaration }
    | { kind: 'event'; node: Event }
    | undefined {
    let current: AstNode | undefined = stmt.$container;
    while (current) {
        if (current.$type === 'FunctionDeclaration') return { kind: 'function', node: current as FunctionDeclaration };
        if (current.$type === 'Event') return { kind: 'event', node: current as Event };
        current = current.$container;
    }
    return undefined;
}

export function computeRemindBodyLocator(stmt: RemindStatement): RemindBodyLocator | undefined {
    const owner = findRemindOwner(stmt);
    if (!owner?.node.codeBlock) return undefined;
    const index = collectRemindStatements(owner.node.codeBlock).indexOf(stmt);
    if (index < 0) return undefined;
    return { ownerKind: owner.kind, ownerName: owner.node.name, index };
}

export function resolveRemindBodyLocator(model: Model, locator: RemindBodyLocator): CodeBlock | undefined {
    const owner = locator.ownerKind === 'function'
        ? model.World.functions.find(f => f.name === locator.ownerName)
        : model.World.events.find(e => e.name === locator.ownerName);
    if (!owner?.codeBlock) return undefined;
    return collectRemindStatements(owner.codeBlock)[locator.index]?.body;
}
