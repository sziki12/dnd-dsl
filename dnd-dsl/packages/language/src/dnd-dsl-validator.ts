import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import {
    isBoolVal,
    isCodeBlock,
    isEnumRefItem,
    isEnumValueRef,
    isIntVal,
    isListLiteral,
    isLocationRefItem,
    isNpcRefItem,
    isObjectDeclaration,
    isQuestRefItem,
    isRefChain,
    isStringVal,
    isVariableRefItem,
    isWorldRefItem,
    type CollectionRef,
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
import { unwrapExpression } from './evaluation/dnd-dsl-state-path.js';
import { PREDEFINED_SIGNATURES, getPredefinedSignature, predefinedArity } from './evaluation/dnd-dsl-predefined-signatures.js';

type NamedNode = Enum | EnumValueDecl | Event | FunctionDeclaration | Location | Npc | Objective | Quest;
import type { DndDslServices } from './dnd-dsl-module.js';

/** CollectionRef.head kind -> its legal `field` names. Kept in sync with
 *  ENTITY_COLLECTION_FIELDS in scope-provider.ts (the "entity" subset here -
 *  locations/npcs/quests/objectives/sublocations - is exactly that set) and with
 *  LangiumInterpreterService.resolveCollection, which is what actually reads each. */
const COLLECTION_FIELDS: Record<string, string[]> = {
    World: ['locations', 'npcs', 'quests', 'events', 'functions', 'enums', 'variables'],
    Location: ['sublocations', 'exits', 'variables'],
    Quest: ['objectives', 'variables'],
    Npc: ['variables'],
    Enum: ['values'],
};

/**
 * Register custom validation checks.
 */
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
        CollectionRef: validator.checkCollectionField,
        ListLiteral: validator.checkListLiteral,
        FunctionCall: validator.checkPredefinedCall,
        ForStatement: validator.checkForSource,
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
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

    /** The kind of an element the validator can tell from syntax alone; anything computed
     *  (a reference, an arithmetic expression, a call) is unknown and never flagged. */
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
        if (stmt.source && !this.endsInVariable(stmt.source)) {
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

    /** `for x in <head> . <field> do ... end` - `field` is a plain, unlinked ID (see
     *  the grammar comment on CollectionRef), so an unknown field is a validation
     *  error here rather than a linking failure - this is what gives a DM a readable
     *  "did you mean" instead of a raw "could not resolve reference". */
    checkCollectionField(ref: CollectionRef, accept: ValidationAcceptor): void {
        const kind = this.collectionHeadKind(ref.head);
        if (!kind) {
            accept('error', `A 'for ... in' collection must start with location/npc/quest/world/enum, not '${ref.head.$type}'.`, { node: ref, property: 'head' });
            return;
        }
        const legal = COLLECTION_FIELDS[kind];
        if (!legal.includes(ref.field)) {
            accept('error', `'${ref.field}' is not a collection on ${kind}. Valid options: ${legal.join(', ')}.`, { node: ref, property: 'field' });
        }
    }

    private collectionHeadKind(head: RefChainStart): string | undefined {
        if (isWorldRefItem(head)) return 'World';
        if (isLocationRefItem(head)) return 'Location';
        if (isQuestRefItem(head)) return 'Quest';
        if (isNpcRefItem(head)) return 'Npc';
        if (isEnumRefItem(head)) return 'Enum';
        return undefined;
    }

    // Location.sublocations nests arbitrarily. Langium's default scope provider resolves
    // LocationRef/LocationExit.exit/LocationEntry.entry GLOBALLY (DndScopeProvider only
    // overrides getScope for VariableRef, see scope-provider.ts), so uniqueness must be
    // checked across the full nested tree, not just per-sibling-group, to match actual
    // link resolution semantics.
    private collectAllLocations(locations: Location[]): Location[] {
        return locations.flatMap(l => [l, ...this.collectAllLocations(l.sublocations)]);
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
