import { describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { Model } from "../../src/generated/ast.js";
import { createDndDslServices } from "../../src/dnd-dsl-module.js";
import { registerBuiltinDocument } from "../../src/builtin-documents.js";

async function errorsFor(source: string): Promise<string[]> {
    const created = createDndDslServices(EmptyFileSystem);
    await registerBuiltinDocument(created.shared);
    const document = await parseHelper<Model>(created.DndDsl)(source, { validation: true });
    return [
        ...document.parseResult.parserErrors.map(e => e.message),
        ...(document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message),
    ];
}

const WORLD = `
    world "T"
    location "Forest"
        location "Clearing"
            exit "Path" to "Cave"
        location "Cave"
`;

describe("a loop variable over exits", () => {
    test(".name is allowed", async () => {
        expect(await errorsFor(`${WORLD}
            event "E"
                for s in location "Forest" . sublocations do
                    for e in s . exits do
                        print e . name
                    end
                end
        `)).toEqual([]);
    });

    test(".name is read-only", async () => {
        const errors = await errorsFor(`${WORLD}
            event "E"
                for e in location "Clearing" . exits do
                    set e . name to "x"
                end
        `);
        expect(errors.some(e => e.includes("read-only"))).toBe(true);
    });
});
