import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, MapScope, stream } from "langium";
import type { AstNode, AstNodeDescription, ReferenceInfo, Scope } from "langium";
import {
    type State,
    isChainTail,
    isCodeBlock,
    isState,
    isStateValueRef,
    isEvent,
    isForStatement,
    isLocation,
    isLocationEntry,
    isLocationRef,
    isLocationRefItem,
    isFactionRefItem,
    isNpcRefItem,
    isObjectDeclaration,
    isObjectiveRef,
    isObjectiveRefItem,
    isParentRefItem,
    isQuestRefItem,
    isRefChain,
    isRelationRefItem,
    isThisRefItem,
    isVariableDeclaration,
    isVariableRef,
    isVariableRefItem,
    isWorld,
    isWorldRefItem,
    type Location,
    type Objective,
    type Quest,
    type RefChain,
    type VariableDeclaration,
} from "./generated/ast.js";
import { ENDPOINT_KIND, findRelation } from "./evaluation/dnd-dsl-relations.js";
import { chainHead, lastChainSegment, nearestOwningObject, parentOwningObject, unwrapExpression, type OwningObject } from "./evaluation/dnd-dsl-state-path.js";

/** 
 * CollectionRef.field values whose elements are real named entities with their own `.variables` 
 **/
const ENTITY_COLLECTION_FIELDS = new Set(['npcs', 'factions', 'locations', 'quests', 'objectives', 'sublocations']);

/** The head a step starts from: the step before it in the chain, or the chain's own head for the first step. */
function stepBase(step: AstNode): AstNode | undefined
{
    const chain = step.$container;
    if (!isRefChain(chain)) return undefined;
    const index = step.$containerIndex ?? 0;
    return index === 0 ? chain.first : chain.steps[index - 1];
}

export interface ChildSlot
{
    owner: Location | Quest;
    /** What the children are called in a message: `sublocation` or `objective`. */
    noun: string;
    children: Array<Location | Objective>;
}

/**
 * The children a name may pick, when `ref` is a step down to a child or an `entry`. After `location "A" ->` /
 * `. sublocations` they are A's own sublocations, after `quest "Q" ->` / `. objectives` Q's own objectives, and for
 * `entry` the sublocations of the location it sits in. Names are unique, so the global scope would also link a name
 * that is not a child; scoping to these is what makes a step a check. Undefined when `ref` is not such a reference,
 * or the name before it did not link (that error is enough).
 */
export function childSlot(ref: AstNode): ChildSlot | undefined
{
    const step = ref.$container;
    if (isLocationRef(ref) && isLocationRefItem(step) && step.$containerProperty === "steps")
    {
        const base = stepBase(step);
        const owner = isLocationRefItem(base) ? base.val.val.ref : undefined;
        return owner && { owner, noun: "sublocation", children: owner.sublocations };
    }
    if (isObjectiveRef(ref) && isObjectiveRefItem(step) && step.$containerProperty === "steps")
    {
        const base = stepBase(step);
        const owner = isQuestRefItem(base) ? base.val.val.ref : undefined;
        return owner && { owner, noun: "objective", children: owner.objectives };
    }
    if (isLocationEntry(ref) && isLocation(ref.$container))
    {
        return { owner: ref.$container, noun: "sublocation", children: ref.$container.sublocations };
    }
    return undefined;
}

/** A `for` source that ends in a collection field itself, not in one item of it. */
function isIteratedCollection(source: RefChain): boolean {
    const last = lastChainSegment(source);
    return !!last.field && last.indexes.length === 0;
}

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
                return this.getMemberScope(item.$container, item.$containerIndex ?? 0, context);
            }

            // `... [i] . b` - what follows an index is whatever item the index picks at run
            // time, so there is nothing to enumerate: any name links, the interpreter reads it
            // off the real item.
            if (isVariableRefItem(item) &&
                isChainTail(item.$container) &&
                item.$containerProperty === "rest")
            {
                return this.dynamicMemberScope(item.$container);
            }

            // `let x = <expr>` - the variable's own value expression is scoped to the
            // variables declared in the same block, plus the global variable pool.
            return this.getVariableScope(context.container, context);
        }

        const stepScope = this.getStepScope(context);
        if (stepScope) return stepScope;

        // `StateName::Value` - the value half is scoped to that state's own members.
        // StateValueDecl nodes are only visible inside their State declaration by
        // default, so without this the value never resolves at any use site.
        const container = context.container;
        if (isStateValueRef(container) && context.property === "value")
        {
            const stateDecl = this.resolveState(container.stateName, context);
            if (!stateDecl) return EMPTY_SCOPE;
            return new MapScope(
                stream(stateDecl.values).map(v => this.descriptions.createDescription(v, v.name))
            );
        }

        return super.getScope(context);
    }

    /** See `childSlot`: the children a step or `entry` may name, as a scope, so the global pool never links a name that is not one. */
    private getStepScope(context: ReferenceInfo): Scope | undefined
    {
        const slot = childSlot(context.container);
        if (!slot) return undefined;
        return new MapScope(stream(slot.children).map(child => this.descriptions.createDescription(child, child.name)));
    }

    /**
     * The enclosing World's state by name, or - for a `reference world` script whose
     *  own World declares no states - the loaded world's state from the global index. 
     **/
    private resolveState(name: string, context: ReferenceInfo): State | undefined
    {
        const local = AstUtils.getContainerOfType(context.container, isWorld)?.states.find(e => e.name === name);
        if (local) return local;
        const global = this.getGlobalScope("State", context).getElement(name)?.node;
        return isState(global) ? global : undefined;
    }

    /** Event has no `.variables` field at all - it can never actually be `this`/`parent`
     *  for a computed value (nothing can nest a computed declaration under an Event),
     *  but stays in OwningObject's union because OnBlock's own $container can be one -
     *  handled here defensively rather than assumed unreachable. */
    private variablesOf(owner: OwningObject): VariableDeclaration[] | undefined {
        return isEvent(owner) ? undefined : owner.variables;
    }

    /**
     * Members reachable via `.` from the segment at `restIndex - 1` (or the head
     * when `restIndex === 0`). No global fallback - an unknown member must surface as a
     * linking error, not silently bind to a same-named variable elsewhere in the world.
     *
     * MVP scope: Location.variables, and the variables of an `object`-valued declaration.
     * QuestRefItem / EventRefItem synthetic members (status, fired) land here later.
     */
    private getMemberScope(chain: RefChain, restIndex: number, context: ReferenceInfo): Scope
    {
        const prev = restIndex === 0 ? chainHead(chain) : chain.rest[restIndex - 1];

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
        else if (isObjectiveRefItem(prev))
        {
            members = prev.val.val.ref?.variables;
        }
        else if (isNpcRefItem(prev))
        {
            members = prev.val.val.ref?.variables;
        }
        else if (isFactionRefItem(prev))
        {
            members = prev.val.val.ref?.variables;
        }
        else if (isRelationRefItem(prev))
        {
            // `relation npc "Ann" "Member of" faction "Guards" . Standing` -> that fact's own variables, if it is written
            const host = prev.subject.val.val.ref;
            const type = prev.predicate.ref;
            const target = prev.target.val.val.ref;
            const kind = ENDPOINT_KIND[prev.target.$type];
            members = host && type && target && kind ? findRelation(undefined, host, type.name, kind, target.name)?.variables : undefined;
        }
        else if (isWorldRefItem(prev))
        {
            members = this.worldVariables(prev, context);
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
        else if (isThisRefItem(prev))
        {
            const owner = nearestOwningObject(prev);
            members = owner && this.variablesOf(owner);
        }
        else if (isParentRefItem(prev))
        {
            const owner = nearestOwningObject(prev);
            members = owner && this.variablesOf(parentOwningObject(owner));
        }
        // EventRefItem: no variables, no member scope.

        if (!members || members.length === 0) return EMPTY_SCOPE;

        return new MapScope(
            stream(members).map(d => this.descriptions.createDescription(d, d.target ?? d.name ?? ""))
        );
    }

    /**
     * The variables declared directly on the world a `world` head names: the enclosing world, or, in a
     * `reference world` script (which declares none of its own), the loaded world of that name.
     */
    private worldVariables(head: AstNode, context: ReferenceInfo): VariableDeclaration[] | undefined
    {
        const own = AstUtils.getContainerOfType(head, isWorld);
        if (!own || !own.isReference) return own?.variables;

        for (const description of this.getGlobalScope("World", context).getElements(own.name))
        {
            const node = description.node;
            if (isWorld(node) && !node.isReference) return node.variables;
        }
        return undefined;
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
        const head = chainHead(chain);
        if (isLocationRefItem(head) || isQuestRefItem(head) || isObjectiveRefItem(head) || isNpcRefItem(head) || isFactionRefItem(head))
        {
            return head.val.val.ref?.variables;
        }
        return undefined;
    }

    /** True for a `for x in <collection> do ... end` loop variable whose collection is
     *  one of entities-with-variables (see ENTITY_COLLECTION_FIELDS) - the only case
     *  `.member` through a loop variable is meaningful. A loop variable bound to a
     *  name-only or record collection (events/functions/states/values/exits/variables)
     *  correctly falls through to EMPTY_SCOPE below - it structurally has no members. */
    private isEntityLoopVariable(decl: VariableDeclaration): boolean
    {
        const owner = decl.$container;
        return isForStatement(owner) && owner.loopVar === decl
            && !!owner.source && isIteratedCollection(owner.source) && ENTITY_COLLECTION_FIELDS.has(lastChainSegment(owner.source).field!);
    }

    /** True for a `for x in <list variable> do ... end` loop variable. The elements
     *  are plain values, possibly `object` records whose fields can't be known at link
     *  time, so `.member` gets the same permissive scope - except over a state list
     *  (`Disposition[]`), whose elements are state names with no members at all. */
    private isListLoopVariable(decl: VariableDeclaration): boolean
    {
        const owner = decl.$container;
        if (!isForStatement(owner) || owner.loopVar !== decl || !owner.source) return false;
        const source = owner.source;
        const tail = source.rest.length > 0 ? source.rest[source.rest.length - 1] : chainHead(source);
        const listDecl = isVariableRefItem(tail) ? tail.val.val.ref : undefined;
        return !(listDecl?.isList && listDecl.stateType);
    }

    /** Any name resolves successfully, to a placeholder description that carries no
     *  real information beyond the requested name - only ever used to avoid a linking
     *  error, never dereferenced by identity. getAllElements stays empty deliberately:
     *  completion for a loop variable's members isn't offered yet (fast-follow). */
    private dynamicMemberScope(chain: AstNode): Scope
    {
        const documentUri = AstUtils.getDocument(chain).uri;
        // Hung under the chain so the JSON serializer, which asks a reference's target for its
        // document, can find one; without a container it throws and the world cannot be served.
        const describe = (name: string): AstNodeDescription => ({
            node: { $type: 'DynamicMember', $container: chain, $containerProperty: 'rest', $containerIndex: 0 } as unknown as AstNode,
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
