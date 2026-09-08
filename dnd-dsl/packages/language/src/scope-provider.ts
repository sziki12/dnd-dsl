import { DefaultScopeProvider, EMPTY_SCOPE, MapScope, stream } from "langium";
import type { AstNode, ReferenceInfo, Scope } from "langium";
import {
    isCodeBlock,
    isLocationRefItem,
    isNpcRefItem,
    isObjectDeclaration,
    isQuestRefItem,
    isRefChain,
    isVariableDeclaration,
    isVariableRef,
    isVariableRefItem,
    type RefChain,
    VariableDeclaration,
} from "./generated/ast.js";
import { unwrapExpression } from "./evaluation/dnd-dsl-state-path.js";

export class DndScopeProvider extends DefaultScopeProvider
{
    override getScope(context: ReferenceInfo): Scope
    {
        if (isVariableRef(context.container))
        {
            const item = context.container.$container;

            // `A . b . c` - a reference sitting in RefChain.rest is a MEMBER access:
            // scope it to the members of the segment to its left, never the global
            // variable pool.
            if (
                isVariableRefItem(item) &&
                isRefChain(item.$container) &&
                item.$containerProperty === "rest"
            )
            {
                return this.getMemberScope(item.$container, item.$containerIndex ?? 0);
            }

            return this.getVariableScope(context.container, context);
        }

        return super.getScope(context);
    }

    /**
     * Members reachable via `.` from the segment at `restIndex - 1` (or `chain.first`
     * when `restIndex === 0`). No global fallback - an unknown member must surface as a
     * linking error, not silently bind to a same-named variable elsewhere in the world.
     *
     * MVP scope: Location.variables, and the variables of an `object`-valued declaration.
     * QuestRefItem / EventRefItem synthetic members (status, fired) land here later.
     */
    private getMemberScope(chain: RefChain, restIndex: number): Scope
    {
        const prev = restIndex === 0 ? chain.first : chain.rest[restIndex - 1];

        let members: VariableDeclaration[] | undefined;

        if (isLocationRefItem(prev))
        {
            // `location "High Castle" . <member>` -> that location's own variables
            members = prev.val.val.ref?.variables;
        }
        else if (isQuestRefItem(prev))
        {
            members = prev.val.val.ref?.variables;
        }
        else if (isNpcRefItem(prev))
        {
            members = prev.val.val.ref?.variables;
        }
        else if (isVariableRefItem(prev))
        {
            // `Resources . <member>` -> the variables of an `object`-valued decl
            const value = unwrapExpression(prev.val.val.ref?.value);
            if (isObjectDeclaration(value)) members = value.variables;
        }
        // EventRefItem: no variables, no member scope.

        if (!members || members.length === 0) return EMPTY_SCOPE;

        return new MapScope(
            stream(members).map(d => this.descriptions.createDescription(d, d.target ?? d.name ?? ""))
        );
    }

    private getVariableScope(node: AstNode, context: ReferenceInfo): Scope
    {
        const declarations: VariableDeclaration[] = [];
        let current: AstNode | undefined = context.container.$container;

        while (current)
        {
            if (isCodeBlock(current))
            {
                //Previous declarations are visible only
                for (const code of current.code)
                {
                    if (isVariableDeclaration(code))
                    {
                        declarations.push(code);
                    }
                    //Current statement
                    if (code === context.container) break;
                }
            }
            current = current.$container;
        }
        const globalScope = super.getScope(context);

        if (declarations.length === 0) return globalScope;

        return new MapScope(
            stream(declarations).map(d => this.descriptions.createDescription(d, d.target)),
            globalScope  // fallback
        );
    }
}
