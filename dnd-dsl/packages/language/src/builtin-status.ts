import { AstUtils, type AstNode } from "langium";
import type { LangiumParser } from "langium";
import type { Model, Objective, Quest, StringVal, VariableDeclaration } from "./generated/ast.js";
import { DEFAULT_OBJECTIVE_STATUS, DEFAULT_QUEST_STATUS, STATUS_VARIABLE } from "./evaluation/dnd-dsl-status.js";

const builtIn = new WeakSet<AstNode>();

/** True for the `Status` declaration this file adds, false for one somebody wrote in the source. */
export function isBuiltInStatus(node: AstNode | undefined): boolean {
    return node !== undefined && builtIn.has(node);
}

/**
 * Gives every quest and objective a `let Status = <default>` after the variables written in its
 * source, so `Status` links, reads, `set`s and takes `on change` like any other variable. The
 * default lives here, in the parsed model; a changed value is an ordinary overlay entry, so
 * undo, reset and reparse all fall back to it. A source-declared `Status` is left alone (the
 * validator rejects it).
 */
export function addBuiltInStatus(model: Model | undefined): void {
    for (const quest of model?.World?.quests ?? []) {
        add(quest, DEFAULT_QUEST_STATUS);
        for (const objective of quest.objectives ?? []) add(objective, DEFAULT_OBJECTIVE_STATUS);
    }
}

function add(owner: Quest | Objective, defaultStatus: string): void {
    owner.variables ??= [];
    if (owner.variables.some(v => v.target === STATUS_VARIABLE)) return;

    const value = { $type: "StringVal", val: defaultStatus } as unknown as StringVal;
    const decl = { $type: "VariableDeclaration", target: STATUS_VARIABLE, value } as unknown as VariableDeclaration;
    owner.variables.push(decl);
    builtIn.add(decl);
    AstUtils.linkContentToContainer(owner);
    AstUtils.linkContentToContainer(decl);
}

/** Runs `addBuiltInStatus` on every parse, before the document is indexed and linked. */
export function withBuiltInStatus(parser: LangiumParser): LangiumParser {
    const parse = parser.parse.bind(parser);
    parser.parse = ((input, options) => {
        const result = parse(input, options);
        addBuiltInStatus(result.value as unknown as Model);
        return result;
    }) as typeof parser.parse;
    return parser;
}
