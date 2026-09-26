import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, MapScope, stream } from "langium";
import type { AstNode, AstNodeDescription, ReferenceInfo, Scope } from "langium";
import {
    type Enum,
    isCodeBlock,
    isEnum,
    isEnumValueRef,
    isForStatement,
    isLocationRefItem,
    isNpcRefItem,
    isObjectDeclaration,
    isQuestRefItem,
    isRefChain,
    isVariableDeclaration,
    isVariableRef,
    isVariableRefItem,
    isWorld,
    type RefChain,
    type VariableDeclaration,
} from "./generated/ast.js";
import { unwrapExpression } from "./evaluation/dnd-dsl-state-path.js";

/** 
 * CollectionRef.field values whose elements are real named entities with their own `.variables` 
 **/
const ENTITY_COLLECTION_FIELDS = new Set(['npcs', 'locations', 'quests', 'objectives', 'sublocations']);

export class DndScopeProvider extends DefaultScopeProvider
{
    override getScope(context: ReferenceInfo): Scope
    {
        // variableRef is the node type that can be a reference to a variable
        if (isVariableRef(context.container))
        {
            const item = context.container.$container;

            // `A . b . c` - a reference sitting in RefChain.rest is a MEMBER access:
            // scope it to the members of the segment to its left, never the global variable pool.
            if (isVariableRefItem(item) &&
                isRefChain(item.$container) &&
                item.$containerProperty === "rest")
            {
                return this.getMemberScope(item.$container, item.$containerIndex ?? 0);
            }

            // `let x = <expr>` - the variable's own value expression is scoped to the
            // variables declared in the same block, plus the global variable pool.
            return this.getVariableScope(context.container, context);
        }

        // `EnumName::Value` - the value half is scoped to that enum's own members.
        // EnumValueDecl nodes are only visible inside their Enum declaration by
        // default, so without this the value never resolves at any use site.
        const container = context.container;
        if (isEnumValueRef(container) && context.property === "value")
        {
            const enumDecl = this.resolveEnum(container.enumName, context);
            if (!enumDecl) return EMPTY_SCOPE;
            return new MapScope(
                stream(enumDecl.values).map(v => this.descriptions.createDescription(v, v.name))
            );
        }

        return super.getScope(context);
    }

    /** 
     * The enclosing World's enum by name, or - for a `reference world` script whose
     *  own World declares no enums - the loaded world's enum from the global index. 
     **/
    private resolveEnum(name: string, context: ReferenceInfo): Enum | undefined
    {
        const local = AstUtils.getContainerOfType(context.container, isWorld)?.enums.find(e => e.name === name);
        if (local) return local;
        const global = this.getGlobalScope("Enum", context).getElement(name)?.node;
        return isEnum(global) ? global : undefined;
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
            const decl = prev.val.val.ref;

            // `for x in world . npcs do x . <member>` - x has no static shape, it's
            // bound to a different concrete npc each iteration, so there is nothing to
            // enumerate here. Return a permissive scope instead of EMPTY_SCOPE: any
            // name resolves successfully (to a placeholder never dereferenced for its
            // own identity), so the reference links and there is no permanent
            // "could not resolve reference" error on correct code. The interpreter
            // resolves the real value dynamically at runtime, off the raw $refText,
            // not off this placeholder - see LangiumInterpreterService.evaluateRefChain.
            if (decl && (this.isEntityLoopVariable(decl) || this.isListLoopVariable(decl)))
            {
                return this.dynamicMemberScope(chain);
            }

            // `Resources . <member>` -> the variables of an `object`-valued decl, OR
            // `named_npc . <member>` where named_npc's own value is a bare entity
            // reference (`let named_npc = npc "First NPC"`) -> that entity's own
            // variables. Only a literal, zero-segment head is resolvable this way -
            // the entity has to be known at link time, not chosen at runtime.
            const value = unwrapExpression(decl?.value);
            if (isObjectDeclaration(value)) {
                members = value.variables;
            } else if (isRefChain(value)) {
                members = this.resolveEntityAliasMembers(value);
            }
        }
        // EventRefItem: no variables, no member scope.

        if (!members || members.length === 0) return EMPTY_SCOPE;

        return new MapScope(
            stream(members).map(d => this.descriptions.createDescription(d, d.target ?? d.name ?? ""))
        );
    }

    /** `chain` is a variable's own value expression. If it's a bare `location "X"` /
     *  `quest "X"` / `npc "X"` reference (no further `.` segments), returns that
     *  entity's own `.variables` - lets an alias like `let x = npc "First NPC"`
     *  offer real member completion/linking through `x`, same as through the entity
     *  directly. A chain with rest segments (`npc "X" . Resources`) isn't a bare
     *  entity reference, so it's out of scope here. */
    private resolveEntityAliasMembers(chain: RefChain): VariableDeclaration[] | undefined
    {
        if (chain.rest.length > 0) return undefined;
        if (isLocationRefItem(chain.first) || isQuestRefItem(chain.first) || isNpcRefItem(chain.first))
        {
            return chain.first.val.val.ref?.variables;
        }
        return undefined;
    }

    /** True for a `for x in <collection> do ... end` loop variable whose collection is
     *  one of entities-with-variables (see ENTITY_COLLECTION_FIELDS) - the only case
     *  `.member` through a loop variable is meaningful. A loop variable bound to a
     *  name-only or record collection (events/functions/enums/values/exits/variables)
     *  correctly falls through to EMPTY_SCOPE below - it structurally has no members. */
    private isEntityLoopVariable(decl: VariableDeclaration): boolean
    {
        const owner = decl.$container;
        return isForStatement(owner) && owner.loopVar === decl
            && !!owner.collection && ENTITY_COLLECTION_FIELDS.has(owner.collection.field);
    }

    /** True for a `for x in <list variable> do ... end` loop variable. The elements
     *  are plain values, possibly `object` records whose fields can't be known at link
     *  time, so `.member` gets the same permissive scope - except over an enum list
     *  (`Disposition[]`), whose elements are enum names with no members at all. */
    private isListLoopVariable(decl: VariableDeclaration): boolean
    {
        const owner = decl.$container;
        if (!isForStatement(owner) || owner.loopVar !== decl || !owner.source) return false;
        const source = owner.source;
        const tail = source.rest.length > 0 ? source.rest[source.rest.length - 1] : source.first;
        const listDecl = isVariableRefItem(tail) ? tail.val.val.ref : undefined;
        return !(listDecl?.isList && listDecl.enumType);
    }

    /** Any name resolves successfully, to a placeholder description that carries no
     *  real information beyond the requested name - only ever used to avoid a linking
     *  error, never dereferenced by identity. getAllElements stays empty deliberately:
     *  completion for a loop variable's members isn't offered yet (fast-follow). */
    private dynamicMemberScope(chain: RefChain): Scope
    {
        const documentUri = AstUtils.getDocument(chain).uri;
        const describe = (name: string): AstNodeDescription => ({
            node: { $type: 'DynamicMember' } as unknown as AstNode,
            name,
            type: 'DynamicMember',
            documentUri,
            path: '',
        });
        return {
            getElement: describe,
            getElements: (name: string) => stream([describe(name)]),
            getAllElements: () => stream([]),
        };
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
