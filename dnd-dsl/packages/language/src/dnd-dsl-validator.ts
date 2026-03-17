import type { /*ValidationAcceptor,*/ ValidationChecks } from 'langium';
import type { DndDslAstType, /*Person*/ } from './generated/ast.js';
import type { DndDslServices } from './dnd-dsl-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: DndDslServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.DndDslValidator;
    const checks: ValidationChecks<DndDslAstType> = {
        //Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class DndDslValidator {

    /*checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }*/

}
