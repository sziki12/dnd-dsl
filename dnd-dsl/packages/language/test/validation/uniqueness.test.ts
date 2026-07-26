import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { parseHelper } from "langium/test";
import type { Model } from "../../src/generated/ast.js";
import { createDndDslServices } from "../../src/dnd-dsl-module.js";

let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(async () => {
    const services = createDndDslServices(EmptyFileSystem);
    parse = parseHelper<Model>(services.DndDsl);
});

async function errorsFor(input: string): Promise<string[]> {
    const document: LangiumDocument<Model> = await parse(input, { validation: true });
    return (document.diagnostics ?? [])
        .filter(d => d.severity === 1)
        .map(d => d.message);
}

describe('Duplicate name validation', () => {

    test('flags two locations with the same name at different nesting depths', async () => {
        const errors = await errorsFor(`
            world "Test"
            location "Village Square"
            location "Outer Ring"
                sublocations
                    location "Village Square"
                end
        `);
        expect(errors.filter(e => e.includes('Duplicate Location name "Village Square"'))).toHaveLength(2);
    });

    test('allows uniquely-named locations, including nested ones', async () => {
        const errors = await errorsFor(`
            world "Test"
            location "Village Square"
            location "Outer Ring"
                sublocations
                    location "Back Alley"
                end
        `);
        expect(errors).toHaveLength(0);
    });

    test('flags duplicate quest names', async () => {
        const errors = await errorsFor(`
            world "Test"
            quest "Rising Dead"
                objective "Find the tomb"
            quest "Rising Dead"
                objective "Seal the tomb"
        `);
        expect(errors.filter(e => e.includes('Duplicate Quest name "Rising Dead"'))).toHaveLength(2);
    });

    test('flags duplicate objective names only within the same quest', async () => {
        const errors = await errorsFor(`
            world "Test"
            quest "Rising Dead"
                objective "Find it"
                objective "Find it"
            quest "Buried Secrets"
                objective "Find it"
        `);
        expect(errors.filter(e => e.includes('Duplicate Objective name "Find it"'))).toHaveLength(2);
    });

    test('flags duplicate event and function names', async () => {
        const errors = await errorsFor(`
            world "Test"
            event "Ambush"
            event "Ambush"
            function calc
            return 1
            function calc
            return 2
        `);
        expect(errors.filter(e => e.includes('Duplicate Event name "Ambush"'))).toHaveLength(2);
        expect(errors.filter(e => e.includes('Duplicate Function name "calc"'))).toHaveLength(2);
    });

});
