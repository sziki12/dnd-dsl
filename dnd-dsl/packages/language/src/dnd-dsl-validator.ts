import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import {
    ChangeOccurrence,
    isBoolVal,
    isChangeOccurrence,
    isCodeBlock,

    isEnumRefItem,
    isEnumValueRef,
    isEvent,
    isForStatement,
    isIntVal,
    isListLiteral,
    isLocation,
    isLocationRefItem,
    isNpc,
    isNpcRefItem,
    isObjectDeclaration,
    isObjective,
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
    type Enum,
    type EnumValueDecl,
    type Event,
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
    type RefChainStart,
    type RemindStatement,
    type VariableDeclaration,
    type World,
} from './generated/ast.js';
import { nearestOwningObject, parentOwningObject, unwrapExpression, type OwningObject } from './evaluation/dnd-dsl-state-path.js';
import { PREDEFINED_SIGNATURES, getPredefinedSignature, predefinedArity } from './evaluation/dnd-dsl-predefined-signatures.js';

type NamedNode = Enum | EnumValueDecl | Event | FunctionDeclaration | Location | Npc | Objective | Quest;
import type { DndDslServices } from './dnd-dsl-module.js';

/** 
 * CollectionRef.head kind -> its legal `field` names
 */
export enum ObjectKind {
    World = 'World',
    Location = 'Location',
    Npc = 'Npc',
    Quest = 'Quest',
    Objective = 'Objective',
    Enum = 'Enum',
    Exit = 'Exit',
    Event = 'Event',
    VariableDeclaration = 'VariableDeclaration',
    FunctionDeclaration = 'FunctionDeclaration',
}
export const COLLECTION_FIELDS: Record<ObjectKind, string[]> = {
    [ObjectKind.World]: ['locations', 'npcs', 'quests', 'events', 'functions', 'enums', 'variables'],
    [ObjectKind.Location]: ['sublocations', 'exits', 'variables'],
    [ObjectKind.Exit]: ['identifiers'],
    [ObjectKind.Quest]: ['objectives', 'variables'],
    [ObjectKind.Objective]: [],
    [ObjectKind.Npc]: ['variables'],
    [ObjectKind.Enum]: ['values'],
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
    [ObjectKind.Enum]: [],
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
    locations: ObjectKind.Location,
    sublocations: ObjectKind.Location,
    quests: ObjectKind.Quest,
    objectives: ObjectKind.Objective,
};

/** 
 *  The ObjectKind a RefChainStart head resolves to, for COLLECTION_FIELDS/SIMPLE_FIELDS lookup 
 *  Exported (not a validator method) so the completion provider can offer the
 *  same field names it validates, off the same AST-only logic, no EvalContext needed. 
 **/
export function collectionHeadKind(head: RefChainStart): ObjectKind | undefined {
    if (isWorldRefItem(head)) return ObjectKind.World;
    if (isLocationRefItem(head)) return ObjectKind.Location;
    if (isQuestRefItem(head)) return ObjectKind.Quest;
    if (isNpcRefItem(head)) return ObjectKind.Npc;
    if (isEnumRefItem(head)) return ObjectKind.Enum;
    if (isThisRefItem(head)) return owningObjectKind(nearestOwningObject(head));
    if (isParentRefItem(head)) {
        const owner = nearestOwningObject(head);
        return owner ? owningObjectKind(parentOwningObject(owner)) : undefined;
    }
    if (isVariableRefItem(head)) {
        const decl = head.val.val.ref;
        const owner = decl?.$container;
        if (decl && isForStatement(owner) && owner.loopVar === decl && owner.source.field) {
            return ENTITY_COLLECTION_KIND[owner.source.field];
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
        World: validator.checkUniqueNames,
        Quest: validator.checkUniqueObjectiveNames,
        Enum: validator.checkUniqueEnumValues,
        VariableDeclaration: validator.checkEnumValue,
        IntToBoolExpression: validator.checkEnumComparison,
        RemindStatement: validator.checkRemindPlacement,
        RefChain: validator.checkRefChainField,
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
        this.checkUnique(world.events, accept, 'Event');
        this.checkUnique(world.functions, accept, 'Function');
        this.checkUnique(world.npcs, accept, 'Npc');
        this.checkUnique(world.enums, accept, 'Enum');
    }

    checkUniqueObjectiveNames(quest: Quest, accept: ValidationAcceptor): void {
        this.checkUnique(quest.objectives, accept, 'Objective');
    }

    checkUniqueEnumValues(e: Enum, accept: ValidationAcceptor): void {
        this.checkUnique(e.values, accept, 'enum value');
    }

    checkEnumValue(decl: VariableDeclaration, accept: ValidationAcceptor): void {
        const enumDecl = decl.enumType?.ref;
        if (!enumDecl || !decl.value) return;
        const value = unwrapExpression(decl.value);

        if (decl.isList) {
            if (isListLiteral(value)) {
                for (const element of value.elements) this.checkEnumElement(element, enumDecl, accept);
            } else if (isEnumValueRef(value) || isStringVal(value) || isIntVal(value) || isBoolVal(value)) {
                accept('error', `A ${enumDecl.name}[] variable needs a list, e.g. [${enumDecl.name}::<value>].`, { node: decl, property: 'value' });
            }
            return;
        }

        if (isListLiteral(value)) {
            accept('error', `A list was assigned to a variable declared as ${enumDecl.name}; declare it as ${enumDecl.name}[].`, { node: decl, property: 'value' });
            return;
        }

        if (isEnumValueRef(value)) {
            if (value.enumName !== enumDecl.name) {
                accept('error', `Value of enum ${value.enumName} used where ${enumDecl.name} is expected.`, { node: decl, property: 'value' });
            }
            return;
        }

        if (isStringVal(value)) {
            const allowed = enumDecl.values.map(v => v.name);
            if (!allowed.includes(value.val)) {
                accept('warning', `"${value.val}" is not a value of enum ${enumDecl.name}. Use ${enumDecl.name}::<value> (allowed: ${allowed.join(', ')}).`, { node: decl, property: 'value' });
            }
        }
    }

    private checkEnumElement(element: AstNode, enumDecl: Enum, accept: ValidationAcceptor): void {
        const value = unwrapExpression(element);
        if (isEnumValueRef(value)) {
            if (value.enumName !== enumDecl.name) {
                accept('error', `Value of enum ${value.enumName} in a ${enumDecl.name}[] list.`, { node: value });
            }
        } else if (isStringVal(value)) {
            const allowed = enumDecl.values.map(v => v.name);
            if (!allowed.includes(value.val)) {
                accept('warning', `"${value.val}" is not a value of enum ${enumDecl.name}. Use ${enumDecl.name}::<value> (allowed: ${allowed.join(', ')}).`, { node: value });
            }
        } else if (isIntVal(value) || isBoolVal(value) || isListLiteral(value) || isObjectDeclaration(value)) {
            accept('error', `A ${enumDecl.name}[] list can only hold ${enumDecl.name} values.`, { node: value });
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
        if (isEnumValueRef(node)) return `${node.enumName} values`;
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
        const field = stmt.source.field;
        if (field) {
            const kind = collectionHeadKind(stmt.source.first);
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
        const chain: RefChain = node;
        const tail = chain.rest.length > 0 ? chain.rest[chain.rest.length - 1] : chain.first;
        return isVariableRefItem(tail);
    }

    checkEnumComparison(expr: IntToBoolExpression, accept: ValidationAcceptor): void {
        const left = unwrapExpression(expr.left);
        const right = unwrapExpression(expr.right);
        if (!isEnumValueRef(left) || !isEnumValueRef(right)) return;
        if (left.enumName !== right.enumName) {
            accept('error', `Cannot compare enum ${left.enumName} with enum ${right.enumName}.`, { node: expr });
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
        const headKind = collectionHeadKind(chain.first);
        if (!headKind) {
            accept('error', `'.${chain.field}' needs a location/npc/quest/world/enum/this/parent head, not '${chain.first.$type}'.`, { node: chain, property: 'field' });
            return;
        }

        const legal = COLLECTION_FIELDS[headKind].concat(SIMPLE_FIELDS[headKind]);
        if (!legal.includes(chain.field)) {
            accept('error', `'${chain.field}' is not a field on ${headKind}. Valid options: ${legal.join(', ')}.`, { node: chain, property: 'field' });
            return;
        }
        const c = chain.$container;
        if ((isSetStatement(c) && c.target === chain) || (isChangeOccurrence(c) && c.target === chain)) {
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

    checkChangeOccurrenceTarget(occ: ChangeOccurrence, accept: ValidationAcceptor): void {
        if (!this.endsInVariable(occ.target)) {
            accept('error', `'on change' must target a variable, e.g. 'on change npc "X" . mood do ... end'.`, { node: occ, property: 'target' });
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
     **/
    checkThisParentPlacement(node: ThisRefItem | ParentRefItem, accept: ValidationAcceptor): void {
        for (let current: AstNode | undefined = node.$container; current; current = current.$container) {
            if (isOnBlock(current)) return;
            if (isVariableDeclaration(current) && current.isComputed === 'computed') return;
        }
        const keyword = node.$type === 'ThisRefItem' ? 'this' : 'parent';
        accept('error', `'${keyword}' can only be used inside an 'on change'/'on trigger' handler body, or a 'computed' variable's value.`, { node });
    }

    private checkUnique(items: NamedNode[], accept: ValidationAcceptor, kind: string): void {
        const byName = new Map<string, NamedNode[]>();
        for (const item of items) {
            const group = byName.get(item.name);
            if (group) group.push(item);
            else byName.set(item.name, [item]);
        }
        for (const group of byName.values()) {
            if (group.length > 1) {
                for (const dupe of group) {
                    accept('error', `Duplicate ${kind} name "${dupe.name}" — names must be unique.`, { node: dupe, property: 'name' });
                }
            }
        }
    }

}
