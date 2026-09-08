import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import { isStringVal, type DndDslAstType, type Enum, type EnumValueDecl, type Event, type FunctionDeclaration, type Location, type Npc, type Objective, type Quest, type RemindStatement, type VariableDeclaration, type World } from './generated/ast.js';
import { unwrapExpression } from './evaluation/dnd-dsl-state-path.js';

type NamedNode = Enum | EnumValueDecl | Event | FunctionDeclaration | Location | Npc | Objective | Quest;
import type { DndDslServices } from './dnd-dsl-module.js';

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
        RemindStatement: validator.checkRemindPlacement,
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
        if (!isStringVal(value)) return;
        const allowed = enumDecl.values.map(v => v.name);
        if (!allowed.includes(value.val)) {
            accept('warning', `"${value.val}" is not a value of enum ${enumDecl.name}. Allowed: ${allowed.join(', ')}.`, { node: decl, property: 'value' });
        }
    }

    checkRemindPlacement(stmt: RemindStatement, accept: ValidationAcceptor): void {
        let current: AstNode | undefined = stmt.$container;
        while (current && current.$type !== 'FunctionDeclaration' && current.$type !== 'Event') {
            current = current.$container;
        }
        if (!current) {
            accept('error', `'remind' can only be used inside a function or event body.`, { node: stmt });
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
