import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import {
    ChangeOccurrence,
    isBoolVal,
    isChangeOccurrence,
    isChainTail,
    isCodeBlock,

    isStateRefItem,
    isStateValueRef,
    isEvent,
    isFaction,
    isFactionRefItem,
    isForStatement,
    isIntVal,
    isListLiteral,
    isLocation,
    isLocationRefItem,
    isNpc,
    isNpcRefItem,
    isObjectDeclaration,
    isObjective,
    isObjectiveRefItem,
    isOnBlock,
    isParentRefItem,
    isQuest,
    isQuestRefItem,
    isRefChain,
    isSetStatement,
    isStringVal,
    isThisRefItem,
    isVariableDeclaration,
    isVariableRefItem,
    isWorld,
    isWorldRefItem,
    ParentRefItem,
    ThisRefItem,
    type DndDslAstType,
    type ChainField,
    type ChainTail,
    type State,
    type StateValueDecl,
    type Event,
    type Faction,
    type ForStatement,
    type FunctionCall,
    type FunctionDeclaration,
    type IntToBoolExpression,
    type ListLiteral,
    type Location,
    type Npc,
    type Objective,
    type Quest,
    type RefChain,
    type Relation,
    type RelationRefItem,
    type RemindStatement,
    type SetStatement,
    type VariableDeclaration,
    type World,
} from './generated/ast.js';
import { chainHead, lastChainSegment, nearestOwningObject, parentOwningObject, unwrapExpression, type ChainHead, type OwningObject } from './evaluation/dnd-dsl-state-path.js';
import { PREDEFINED_SIGNATURES, getPredefinedSignature, predefinedArity } from './evaluation/dnd-dsl-predefined-signatures.js';
import { AstUtils } from 'langium';
import { NAMED_COLLECTION_FIELDS } from './evaluation/dnd-dsl-expression-operations.js';
import { OBJECTIVE_STATUSES, QUEST_STATUSES, STATUS_VARIABLE } from './evaluation/dnd-dsl-status.js';
import { isBuiltInStatus } from './builtin-status.js';
import { BUILTIN_WORLD_NAME } from './builtin-documents.js';
import { ENDPOINT_KIND, HOST_KIND } from './evaluation/dnd-dsl-relations.js';

type NamedNode = State | StateValueDecl | Event | Faction | FunctionDeclaration | Location | Npc | Objective | Quest;
import type { DndDslServices } from './dnd-dsl-module.js';

/** 
 * CollectionRef.head kind -> its legal `field` names
 */
export enum ObjectKind {
    World = 'World',
    Location = 'Location',
    Npc = 'Npc',
    Faction = 'Faction',
    Quest = 'Quest',
    Objective = 'Objective',
    State = 'State',
    Exit = 'Exit',
    Event = 'Event',
    VariableDeclaration = 'VariableDeclaration',
    FunctionDeclaration = 'FunctionDeclaration',
}
export const COLLECTION_FIELDS: Record<ObjectKind, string[]> = {
    [ObjectKind.World]: ['locations', 'npcs', 'factions', 'quests', 'events', 'functions', 'states', 'variables'],
    [ObjectKind.Location]: ['sublocations', 'exits', 'variables'],
    [ObjectKind.Exit]: ['identifiers'],
    [ObjectKind.Quest]: ['objectives', 'variables'],
    [ObjectKind.Objective]: [],
    [ObjectKind.Npc]: ['variables'],
    [ObjectKind.Faction]: ['variables'],
    [ObjectKind.State]: ['values'],
    [ObjectKind.VariableDeclaration]: [],
    [ObjectKind.FunctionDeclaration]: [],
    [ObjectKind.Event]: []
};

export const SIMPLE_FIELDS: Record<ObjectKind, string[]> = {
    [ObjectKind.World]: ['name', 'description'],
    [ObjectKind.Location]: ['name', 'description'],
    [ObjectKind.Exit]: ['name', 'source', 'target', 'description'],
    [ObjectKind.Quest]: ['name', 'description'],
    [ObjectKind.Objective]: ['name', 'description'],
    [ObjectKind.Npc]: ['name', 'description'],
    [ObjectKind.Faction]: ['name', 'description'],
    [ObjectKind.State]: [],
    [ObjectKind.VariableDeclaration]: ['name', 'value'],
    [ObjectKind.FunctionDeclaration]: [],
    [ObjectKind.Event]: ['name', 'description']
};

export enum STATEMENT_KIND {
    SingleValue = 'SingleValue',
    Collection = 'Collection',
    All = 'All',
    None = 'None'
}

/** 
 *  Collection fields whose elements are real named entities with their own
 *  `.variables`, mapped to the ObjectKind those elements resolve to
 **/
const ENTITY_COLLECTION_KIND: Partial<Record<string, ObjectKind>> = {
    npcs: ObjectKind.Npc,
    factions: ObjectKind.Faction,
    locations: ObjectKind.Location,
    sublocations: ObjectKind.Location,
    quests: ObjectKind.Quest,
    objectives: ObjectKind.Objective,
};

/** A segment's field. The generated type of `ChainTail.field` says it is always set, which would narrow a falsiness test to `never`. */
function fieldOf(segment: RefChain | ChainTail): ChainField | undefined {
    return segment.field;
}

/** Every collection field name, whichever kind of entity has it. */
const COLLECTION_FIELD_NAMES = new Set(Object.values(COLLECTION_FIELDS).flat());

/**
 *  The ObjectKind a RefChainStart head resolves to, for COLLECTION_FIELDS/SIMPLE_FIELDS lookup 
 *  Exported (not a validator method) so the completion provider can offer the
 *  same field names it validates, off the same AST-only logic, no EvalContext needed. 
 **/
export function collectionHeadKind(head: ChainHead): ObjectKind | undefined {
    if (isWorldRefItem(head)) return ObjectKind.World;
    if (isLocationRefItem(head)) return ObjectKind.Location;
    if (isQuestRefItem(head)) return ObjectKind.Quest;
    if (isObjectiveRefItem(head)) return ObjectKind.Objective;
    if (isNpcRefItem(head)) return ObjectKind.Npc;
    if (isFactionRefItem(head)) return ObjectKind.Faction;
    if (isStateRefItem(head)) return ObjectKind.State;
    if (isThisRefItem(head)) return owningObjectKind(nearestOwningObject(head));
    if (isParentRefItem(head)) {
        const owner = nearestOwningObject(head);
        return owner ? owningObjectKind(parentOwningObject(owner)) : undefined;
    }
    if (isVariableRefItem(head)) {
        const decl = head.val.val.ref;
        const owner = decl?.$container;
        if (decl && isForStatement(owner) && owner.loopVar === decl) {
            const last = lastChainSegment(owner.source);
            if (last.field && last.indexes.length === 0) return ENTITY_COLLECTION_KIND[last.field];
        }
    }
    return undefined;
}

function owningObjectKind(owner: OwningObject | undefined): ObjectKind | undefined {
    if (!owner) return undefined;
    if (isWorld(owner)) return ObjectKind.World;
    if (isLocation(owner)) return ObjectKind.Location;
    if (isQuest(owner)) return ObjectKind.Quest;
    if (isNpc(owner)) return ObjectKind.Npc;
    if (isFaction(owner)) return ObjectKind.Faction;
    if (isObjective(owner)) return ObjectKind.Objective;
    if (isEvent(owner)) return ObjectKind.Event;
    return undefined; // ObjectDeclaration has no ObjectKind of its own
}

/**
 * Register custom validation checks.
 **/
export function registerValidationChecks(services: DndDslServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.DndDslValidator;
    const checks: ValidationChecks<DndDslAstType> = {
        World: [validator.checkUniqueNames, validator.checkRelationTypes],
        Relation: validator.checkRelation,
        RelationRefItem: validator.checkRelationQuery,
        State: validator.checkUniqueStateValues,
        VariableDeclaration: [validator.checkStateValue, validator.checkStatusDeclaration],
        SetStatement: validator.checkStatusAssignment,
        IntToBoolExpression: validator.checkStateComparison,
        RemindStatement: validator.checkRemindPlacement,
        RefChain: [validator.checkRefChainField, validator.checkRefChainIndexes],
        ChainTail: validator.checkChainTail,
        ListLiteral: validator.checkListLiteral,
        FunctionCall: validator.checkPredefinedCall,
        ForStatement: validator.checkForSource,
        ChangeOccurrence: validator.checkChangeOccurrenceTarget,
        ThisRefItem: validator.checkThisParentPlacement,
        ParentRefItem: validator.checkThisParentPlacement,
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 **/
export class DndDslValidator {

    checkUniqueNames(world: World, accept: ValidationAcceptor): void {
        this.checkUnique(this.collectAllLocations(world.locations), accept, 'Location');
        this.checkUnique(world.quests, accept, 'Quest');
        // `objective completed "X"` and `fail objective "X"` name an objective on its own, with
        // no quest in front of it, so the name has to be unique across every quest.
        this.checkUnique(world.quests.flatMap(q => q.objectives), accept, 'Objective', 'names must be unique across all quests.');
        this.checkUnique(world.events, accept, 'Event');
        this.checkUnique(world.functions, accept, 'Function');
        this.checkUnique(world.npcs, accept, 'Npc');
        this.checkUnique(world.factions, accept, 'Faction');
        this.checkUnique(world.states, accept, 'State');
    }

    /** Only the built-in relation types exist for now: a world cannot declare its own, which would also shadow a built-in one of the same name. */
    checkRelationTypes(world: World, accept: ValidationAcceptor): void {
        if (world.name === BUILTIN_WORLD_NAME) return;
        for (const type of world.relationTypes) {
            accept('error', `Relation types cannot be declared yet; only the built-in ones exist.`, { node: type, property: 'name' });
        }
    }

    /**
     * A fact must start from a kind its type lists in `from`, point at a kind it lists in `to`, and not repeat an
     * earlier fact of the host. An unresolved type name is already a linking error, so it is skipped here.
     */
    checkRelation(fact: Relation, accept: ValidationAcceptor): void {
        const type = fact.predicate.ref;
        if (!type) return;

        const hostKind = HOST_KIND[fact.$container.$type];
        if (hostKind && !(type.sources as string[]).includes(hostKind)) {
            accept('error', `'${type.name}' cannot start from a ${hostKind}; it starts from: ${type.sources.join(', ')}.`, { node: fact, property: 'predicate' });
        }

        const targetKind = ENDPOINT_KIND[fact.target.$type];
        if (targetKind && !(type.targets as string[]).includes(targetKind)) {
            accept('error', `'${type.name}' cannot point at a ${targetKind}; it points at: ${type.targets.join(', ')}.`, { node: fact, property: 'target' });
        }

        const key = this.relationKey(fact);
        const earlier = fact.$container.relations.slice(0, fact.$containerIndex ?? 0);
        if (earlier.some(other => this.relationKey(other) === key)) {
            accept('error', `Duplicate relation '${type.name}' to ${targetKind} "${fact.target.val.val.$refText}" in ${hostKind} "${fact.$container.name}".`, { node: fact });
        }
    }

    /** `relation npc "A" "T" faction "F"` is a question, so a fact that is not written is fine; only a kind the type cannot join is wrong. */
    checkRelationQuery(query: RelationRefItem, accept: ValidationAcceptor): void {
        const type = query.predicate.ref;
        if (!type) return;

        const subjectKind = ENDPOINT_KIND[query.subject.$type];
        if (subjectKind && !(type.sources as string[]).includes(subjectKind)) {
            accept('error', `'${type.name}' cannot start from a ${subjectKind}; it starts from: ${type.sources.join(', ')}.`, { node: query, property: 'subject' });
        }

        const targetKind = ENDPOINT_KIND[query.target.$type];
        if (targetKind && !(type.targets as string[]).includes(targetKind)) {
            accept('error', `'${type.name}' cannot point at a ${targetKind}; it points at: ${type.targets.join(', ')}.`, { node: query, property: 'target' });
        }
    }

    /** What makes a fact the same fact: its type, the kind of its target and the target's name. */
    private relationKey(fact: Relation): string {
        const type = fact.predicate.ref?.name ?? fact.predicate.$refText;
        return `${type}\u0000${ENDPOINT_KIND[fact.target.$type]}\u0000${fact.target.val.val.$refText}`;
    }

    checkUniqueStateValues(e: State, accept: ValidationAcceptor): void {
        this.checkUnique(e.values, accept, 'state value');
    }

    checkStatusDeclaration(decl: VariableDeclaration, accept: ValidationAcceptor): void {
        if (decl.target !== STATUS_VARIABLE || isBuiltInStatus(decl)) return;
        if (!isQuest(decl.$container) && !isObjective(decl.$container)) return;
        accept('error', `'${STATUS_VARIABLE}' is built into every quest and objective and cannot be declared again.`, { node: decl, property: 'target' });
    }

    /** `set quest "X" . Status = "Bogus"` is caught here when the value is a literal or a state value; any other expression is checked when it runs. */
    checkStatusAssignment(stmt: SetStatement, accept: ValidationAcceptor): void {
        const chain = stmt.target;
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chainHead(chain);
        const decl = isVariableRefItem(tail) ? tail.val.val.ref : undefined;
        if (!decl || !isBuiltInStatus(decl)) return;

        const owner = isQuest(decl.$container) ? 'quest' : 'objective';
        const allowed: readonly string[] = owner === 'quest' ? QUEST_STATUSES : OBJECTIVE_STATUSES;
        const value = unwrapExpression(stmt.value);
        const given = isStringVal(value) ? value.val
            : isStateValueRef(value) ? (value.value.ref?.name ?? value.value.$refText)
            : undefined;
        if (given === undefined || allowed.includes(given)) return;
        accept('error', `'${given}' is not a ${owner} status. Use one of: ${allowed.join(', ')}.`, { node: stmt, property: 'value' });
    }

    checkStateValue(decl: VariableDeclaration, accept: ValidationAcceptor): void {
        const stateDecl = decl.stateType?.ref;
        if (!stateDecl || !decl.value) return;
        const value = unwrapExpression(decl.value);

        if (decl.isList) {
            if (isListLiteral(value)) {
                for (const element of value.elements) this.checkStateElement(element, stateDecl, accept);
            } else if (isStateValueRef(value) || isStringVal(value) || isIntVal(value) || isBoolVal(value)) {
                accept('error', `A ${stateDecl.name}[] variable needs a list, e.g. [${stateDecl.name}::<value>].`, { node: decl, property: 'value' });
            }
            return;
        }

        if (isListLiteral(value)) {
            accept('error', `A list was assigned to a variable declared as ${stateDecl.name}; declare it as ${stateDecl.name}[].`, { node: decl, property: 'value' });
            return;
        }

        if (isStateValueRef(value)) {
            if (value.stateName !== stateDecl.name) {
                accept('error', `Value of state ${value.stateName} used where ${stateDecl.name} is expected.`, { node: decl, property: 'value' });
            }
            return;
        }

        if (isStringVal(value)) {
            const allowed = stateDecl.values.map(v => v.name);
            if (!allowed.includes(value.val)) {
                accept('warning', `"${value.val}" is not a value of state ${stateDecl.name}. Use ${stateDecl.name}::<value> (allowed: ${allowed.join(', ')}).`, { node: decl, property: 'value' });
            }
        }
    }

    private checkStateElement(element: AstNode, stateDecl: State, accept: ValidationAcceptor): void {
        const value = unwrapExpression(element);
        if (isStateValueRef(value)) {
            if (value.stateName !== stateDecl.name) {
                accept('error', `Value of state ${value.stateName} in a ${stateDecl.name}[] list.`, { node: value });
            }
        } else if (isStringVal(value)) {
            const allowed = stateDecl.values.map(v => v.name);
            if (!allowed.includes(value.val)) {
                accept('warning', `"${value.val}" is not a value of state ${stateDecl.name}. Use ${stateDecl.name}::<value> (allowed: ${allowed.join(', ')}).`, { node: value });
            }
        } else if (isIntVal(value) || isBoolVal(value) || isListLiteral(value) || isObjectDeclaration(value)) {
            accept('error', `A ${stateDecl.name}[] list can only hold ${stateDecl.name} values.`, { node: value });
        }
    }

    checkListLiteral(list: ListLiteral, accept: ValidationAcceptor): void {
        const kinds = new Set<string>();
        for (const element of list.elements) {
            const kind = this.literalKind(unwrapExpression(element));
            if (kind) kinds.add(kind);
        }
        if (kinds.size > 1) {
            accept('warning', `List mixes ${[...kinds].join(', ')}; keep the items of a list the same kind.`, { node: list });
        }
    }

    /**
     *  The kind of an element the validator can tell from syntax alone
     *  Anything computed (a reference, an arithmetic expression, a call) is unknown and never flagged. 
     **/
    private literalKind(node: AstNode | undefined): string | undefined {
        if (isIntVal(node)) return 'numbers';
        if (isStringVal(node)) return 'strings';
        if (isBoolVal(node)) return 'booleans';
        if (isStateValueRef(node)) return `${node.stateName} values`;
        if (isListLiteral(node)) return 'lists';
        if (isObjectDeclaration(node)) return 'objects';
        return undefined;
    }

    checkPredefinedCall(call: FunctionCall, accept: ValidationAcceptor): void {
        if (!call.predefined) return;
        const sig = getPredefinedSignature(call.predefinedTarget ?? '');
        if (!sig) {
            accept('error', `Unknown predefined function '${call.predefinedTarget}'. Available: ${PREDEFINED_SIGNATURES.map(s => s.name).join(', ')}.`, { node: call, property: 'predefinedTarget' });
            return;
        }

        const { min, max } = predefinedArity(sig);
        if (call.params.length < min || call.params.length > max) {
            const expected = min === max ? `${min}` : `${min} to ${max}`;
            accept('error', `'${sig.name}' takes ${expected} argument(s) (${sig.params.join(', ')}), got ${call.params.length}.`, { node: call, property: 'predefinedTarget' });
            return;
        }

        // Statement position (a `Code` entry of a CodeBlock): the call's own value is
        // unused, so it either stores its result into its first argument or does nothing.
        if (!isCodeBlock(call.$container)) return;
        if (sig.writesBack) {
            if (!this.endsInVariable(unwrapExpression(call.params[0]))) {
                accept('error', `'${sig.name}' as a statement stores its result into its first argument, which must be a variable.`, { node: call.params[0] });
            }
        } else {
            accept('warning', `The result of '${sig.name}' is discarded; use it in an expression.`, { node: call, property: 'predefinedTarget' });
        }
    }

    checkForSource(stmt: ForStatement, accept: ValidationAcceptor): void {
        const last = lastChainSegment(stmt.source);
        if (isChainTail(last)) {
            // What the continuation hangs off is only known when the script runs, so only the shape is checked.
            const lastField = fieldOf(last);
            if (lastField && !COLLECTION_FIELD_NAMES.has(lastField) && last.indexes.length === 0) {
                accept('error', `'${lastField}' is a single value, not a list - 'for ... in' needs something iterable.`, { node: stmt, property: 'source' });
            } else if (lastField && last.indexes.length > 0) {
                accept('error', `'for ... in' needs a list or a collection, not one item of it.`, { node: stmt, property: 'source' });
            }
            return;
        }
        const field = stmt.source.field;
        if (field && stmt.source.indexes.length > 0) {
            accept('error', `'for ... in' needs a list or a collection, not one item of it.`, { node: stmt, property: 'source' });
            return;
        }
        if (field) {
            const kind = collectionHeadKind(chainHead(stmt.source));
            if (kind && !COLLECTION_FIELDS[kind].includes(field)) {
                accept('error', `'${field}' is a single value, not a list - 'for ... in' needs something iterable.`, { node: stmt, property: 'source' });
            }
            return;
        }
        if (!stmt.source.field && !this.endsInVariable(stmt.source)) {
            accept('error', `A 'for ... in' source must be a variable holding a list (npc "X" . items) or a collection such as 'world . npcs'.`, { node: stmt, property: 'source' });
        }
    }

    /** A RefChain whose last segment is a variable reference - the only thing a value can
     *  be stored into or iterated from (`npc "X"` alone is an entity, not a variable). */
    private endsInVariable(node: AstNode | undefined): boolean {
        if (!isRefChain(node)) return false;
        const last = lastChainSegment(node);
        return isChainTail(last) ? !fieldOf(last) && last.rest.length > 0 : this.firstSegmentEndsInVariable(last);
    }

    private firstSegmentEndsInVariable(chain: RefChain): boolean {
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chainHead(chain);
        return isVariableRefItem(tail);
    }

    checkStateComparison(expr: IntToBoolExpression, accept: ValidationAcceptor): void {
        const left = unwrapExpression(expr.left);
        const right = unwrapExpression(expr.right);
        if (!isStateValueRef(left) || !isStateValueRef(right)) return;
        if (left.stateName !== right.stateName) {
            accept('error', `Cannot compare state ${left.stateName} with state ${right.stateName}.`, { node: expr });
        }
    }

    checkRemindPlacement(stmt: RemindStatement, accept: ValidationAcceptor): void {
        for (let current: AstNode | undefined = stmt.$container; current; current = current.$container) {
            // A `remind` reaching `World` can only have come up through `World.script`
            // (a `reference world` script body) - quest/objective handlers hit their
            // owning Quest/Objective first and are rejected.
            if (current.$type === 'FunctionDeclaration' || current.$type === 'Event' || current.$type === 'World') return;
            if (current.$type === 'Quest' || current.$type === 'Objective') break;
        }
        accept('error', `'remind' can only be used inside a function, event, or script body.`, { node: stmt });
    }

    /** field's legality depends on context: inside a `for`'s source it must be an array
     *  (COLLECTION_FIELDS); everywhere else (set target, on-change target, remind pin,
     *  general expression) it must be a scalar (SIMPLE_FIELDS) - arrays can only be
     *  consumed via `for ... in`, never as a plain value, per the current design split. 
     **/
    checkRefChainField(chain: RefChain, accept: ValidationAcceptor): void {
        if (!chain.field) return;
        if (chain.rest.length > 0) {
            accept('error', `'.${chain.field}' must be the first member access after the head, not after '.${chain.rest[chain.rest.length - 1].val.val.$refText}'.`, { node: chain, property: 'field' });
            return;
        }
        const headKind = collectionHeadKind(chainHead(chain));
        if (!headKind) {
            accept('error', `'.${chain.field}' needs a location/npc/quest/world/state/this/parent head, not '${chainHead(chain).$type}'.`, { node: chain, property: 'field' });
            return;
        }

        const legal = COLLECTION_FIELDS[headKind].concat(SIMPLE_FIELDS[headKind]);
        if (!legal.includes(chain.field)) {
            accept('error', `'${chain.field}' is not a field on ${headKind}. Valid options: ${legal.join(', ')}.`, { node: chain, property: 'field' });
            return;
        }
        const c = chain.$container;
        if (chain.indexes.length === 0 && ((isSetStatement(c) && c.target === chain) || (isChangeOccurrence(c) && c.target === chain))) {
            accept('error', `'.${chain.field}' is read-only and can't be a 'set'/'on change' target.`, { node: chain, property: 'field' });
        }
    }

    // Location.sublocations nests arbitrarily. Langium's default scope provider resolves
    // LocationRef/LocationExit.exit/LocationEntry.entry GLOBALLY (DndScopeProvider only
    // overrides getScope for VariableRef, see scope-provider.ts), so uniqueness must be
    // checked across the full nested tree, not just per-sibling-group, to match actual
    // link resolution semantics.
    private collectAllLocations(locations: Location[]): Location[] {
        return locations.flatMap(l => [l, ...this.collectAllLocations(l.sublocations)]);
    }

    /**
     *  `x[i]`: a variable holding a list is indexed by a whole number; a collection field is indexed by a
     *  whole number or, for collections of named things, by a name. A literal that is certainly wrong is an
     *  error here; anything computed is checked when it runs. Also where a chain may not appear at all.
     **/
    checkRefChainIndexes(chain: RefChain, accept: ValidationAcceptor): void {
        if (chain.indexes.length > 0) {
            const knownNames = chain.field ? this.knownChildNames(chain) : undefined;
            this.checkSegmentIndexes(chain, accept, knownNames);
            if (!chain.field && !this.firstSegmentEndsInVariable(chain)) {
                accept('error', `Only a variable holding a list can be indexed, e.g. npc "X" . items[0].`, { node: chain, property: 'indexes' });
            }
        }
        if ((chain.field && chain.indexes.length > 0) || chain.next) {
            if (this.isInsideEntityVariable(chain)) {
                accept('error', `Indexing a collection, or carrying on after an index, works in functions, events, handlers and scripts, not in a variable's value.`, { node: chain, property: 'indexes' });
            }
        }
        const container = chain.$container;
        if (chain.next && isSetStatement(container) && container.target === chain) {
            const tail = chain.next;
            const shapeOk = !!chain.field && chain.indexes.length > 0 && !fieldOf(tail) && !tail.next && tail.rest.length > 0;
            if (!shapeOk) {
                accept('error', `'set' through an indexed item needs the form <entity> . <collection>[i] . <variable>, e.g. set quest "Q" . objectives[0] . Status = "Failed".`, { node: chain, property: 'next' });
            }
        }
    }

    checkChainTail(tail: ChainTail, accept: ValidationAcceptor): void {
        if (tail.indexes.length > 0) this.checkSegmentIndexes(tail, accept, undefined);
    }

    private checkSegmentIndexes(segment: RefChain | ChainTail, accept: ValidationAcceptor, knownNames: string[] | undefined): void {
        const field = segment.field;
        if (field && !COLLECTION_FIELD_NAMES.has(field)) {
            accept('error', `'.${field}' is a single value, not a list, so it cannot be indexed.`, { node: segment, property: 'indexes' });
            return;
        }
        for (const [i, index] of segment.indexes.entries()) {
            const value = unwrapExpression(index);
            if (isBoolVal(value) || isListLiteral(value)) {
                accept('error', field ? `A collection is indexed by a whole number or a name.` : `A list is indexed by a whole number.`, { node: segment, property: 'indexes', index: i });
            } else if (isStringVal(value)) {
                if (!field || !NAMED_COLLECTION_FIELDS.has(field)) {
                    accept('error', field ? `'.${field}' has no names to index by; use a whole number.` : `A list is indexed by a whole number.`, { node: segment, property: 'indexes', index: i });
                } else if (knownNames && !knownNames.includes(value.val)) {
                    accept('error', `No item named "${value.val}" in '.${field}'. Available: ${knownNames.length > 0 ? knownNames.join(', ') : '(none)'}.`, { node: segment, property: 'indexes', index: i });
                }
            }
        }
    }

    /** The item names of `<head> . <field>` when the head is a fixed entity, else undefined (not knowable before the script runs). */
    private knownChildNames(chain: RefChain): string[] | undefined {
        const field = chain.field;
        const head = chainHead(chain);
        if (isQuestRefItem(head) && field === 'objectives') return head.val.val.ref?.objectives.map(o => o.name);
        if (isLocationRefItem(head) && field === 'sublocations') return head.val.val.ref?.sublocations.map(l => l.name);
        if (isLocationRefItem(head) && field === 'exits') return head.val.val.ref?.exits.map(e => e.name);
        if (isStateRefItem(head) && field === 'values') return head.val.ref?.values.map(v => v.name);
        if (isWorldRefItem(head)) {
            const world = AstUtils.getContainerOfType(chain, isWorld);
            // A `reference world` script holds none of the world's own items.
            if (!world || world.isReference) return undefined;
            const byField: Record<string, { name: string }[] | undefined> = {
                locations: this.collectAllLocations(world.locations), npcs: world.npcs, factions: world.factions, quests: world.quests,
                events: world.events, functions: world.functions, states: world.states,
            };
            return byField[field ?? '']?.map(n => n.name);
        }
        return undefined;
    }

    /** True for the value of a `let` declared on an entity (location, npc, quest, ...), which the served-state evaluators read too. */
    private isInsideEntityVariable(node: AstNode): boolean {
        let sawDeclaration = false;
        for (let current = node.$container; current; current = current.$container) {
            if (isCodeBlock(current) || isOnBlock(current)) return false;
            if (isVariableDeclaration(current)) sawDeclaration = true;
            if (isLocation(current) || isNpc(current) || isFaction(current) || isQuest(current) || isObjective(current) || isWorld(current)) return sawDeclaration;
        }
        return false;
    }

    checkChangeOccurrenceTarget(occ: ChangeOccurrence, accept: ValidationAcceptor): void {
        if (!this.endsInVariable(occ.target)) {
            accept('error', `'on change' must target a variable, e.g. 'on change npc "X" . mood do ... end'.`, { node: occ, property: 'target' });
        } else if (occ.target.indexes.length > 0 || occ.target.next) {
            accept('error', `'on change' watches a whole variable, not one item of it.`, { node: occ, property: 'target' });
        }
    }

    /** 
     *  `this`/`parent` are resolved by container-walk (DndScopeProvider inside an
     *  `object...end` block, LangiumInterpreterService.fireHandler inside a handler
     *  body) rather than a cross-reference, so nothing else makes them meaningful -
     *  restricted here to the two positions that give them something to resolve
     *  against. Walking every ancestor (not stopping at the first CodeBlock/etc.)
     *  means a nested object's own non-computed variables, or a ConditionalBlock
     *  inside a handler body, don't break the check - only whether an OnBlock or a
     *  computed VariableDeclaration encloses the reference at all matters.
     *  A quest's or objective's own `on completed` / `on failed` block counts as a
     *  handler body too: it is a bare CodeBlock owned by the Quest/Objective, not an
     *  OnBlock, but the interpreter binds `this`/`parent` for it the same way.
     **/
    checkThisParentPlacement(node: ThisRefItem | ParentRefItem, accept: ValidationAcceptor): void {
        for (let current: AstNode | undefined = node.$container; current; current = current.$container) {
            if (isOnBlock(current)) return;
            if (isCodeBlock(current) && (isQuest(current.$container) || isObjective(current.$container))) return;
            if (isVariableDeclaration(current) && current.isComputed === 'computed') return;
        }
        const keyword = node.$type === 'ThisRefItem' ? 'this' : 'parent';
        accept('error', `'${keyword}' can only be used inside an 'on change'/'on trigger'/'on completed'/'on failed' body, or a 'computed' variable's value.`, { node });
    }

    private checkUnique(items: NamedNode[], accept: ValidationAcceptor, kind: string, rule = 'names must be unique.'): void {
        const byName = new Map<string, NamedNode[]>();
        for (const item of items) {
            const group = byName.get(item.name);
            if (group) group.push(item);
            else byName.set(item.name, [item]);
        }
        for (const group of byName.values()) {
            if (group.length > 1) {
                for (const dupe of group) {
                    accept('error', `Duplicate ${kind} name "${dupe.name}" — ${rule}`, { node: dupe, property: 'name' });
                }
            }
        }
    }

}
