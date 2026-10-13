import { describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { Model } from "../../src/generated/ast.js";
import { createDndDslServices } from "../../src/dnd-dsl-module.js";
import { registerBuiltinDocument } from "../../src/builtin-documents.js";

// Fresh services per case: an objective is not in its document's local scope, so its name is
// resolved through the global index, where an earlier case's document would shadow this one.
async function open(source: string, validation = true) {
    const created = createDndDslServices(EmptyFileSystem);
    await registerBuiltinDocument(created.shared);
    const document = await parseHelper<Model>(created.DndDsl)(source, { validation });
    return { services: created.DndDsl, document };
}

async function errorsFor(source: string): Promise<string[]> {
    const { document } = await open(source);
    return [
        ...document.parseResult.parserErrors.map(e => e.message),
        ...(document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message),
    ];
}

const WORLD = `
    world "T"
    location "A"
        let Items = [10, 20, 30]
        let Grid = [[1, 2], [3, 4]]
    quest "Q"
        objective "Find it"
`;

describe("indexing a list variable", () => {
    test("`list[i]`, `list[i][j]` and an expression as the index parse and link", async () => {
        expect(await errorsFor(`${WORLD}
            function read param i
                return location "A" . Items[i + 1]
            event "E"
                print location "A" . Items[1]
                print location "A" . Grid[1][0]
        `)).toEqual([]);
    });

    test("a local list can be indexed", async () => {
        expect(await errorsFor(`${WORLD}
            function f
                let xs = [1, 2, 3]
                return xs[0]
        `)).toEqual([]);
    });

    test("`set list[i] = v` is allowed, also nested", async () => {
        expect(await errorsFor(`${WORLD}
            event "E"
                set location "A" . Items[0] = 5
                set location "A" . Grid[1][0] = 5
        `)).toEqual([]);
    });

    test("the loop and write-back forms accept an indexed source or first argument", async () => {
        expect(await errorsFor(`${WORLD}
            event "E"
                for x in location "A" . Grid[1] do
                    print x
                end
                call predefined append with location "A" . Grid[0], 9
        `)).toEqual([]);
    });

    test('an exit tag in square brackets still parses next to an index', async () => {
        const { document } = await open(`
            world "T"
            location "A"
                exit "Door" to "B" ["Hidden": true]
                let Items = [10, 20, 30]
            location "B"
            event "E"
                print location "A" . Items[1]
        `);
        expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
        expect((document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
        expect(document.parseResult.value.World.locations[0].exits[0].identifiers).toHaveLength(1);
    });
});

describe("what cannot be indexed", () => {
    test("an entity or a non-variable", async () => {
        const errors = await errorsFor(`${WORLD}
            event "E"
                print quest "Q"[0]
        `);
        expect(errors.some(e => e.includes("Only a variable holding a list can be indexed"))).toBe(true);
    });

    test("a collection field, for now", async () => {
        const errors = await errorsFor(`${WORLD}
            event "E"
                print quest "Q" . objectives[0]
        `);
        expect(errors.some(e => e.includes("'.objectives' cannot be indexed yet"))).toBe(true);
    });

    test("a string, boolean or list literal as the index", async () => {
        const errors = await errorsFor(`${WORLD}
            event "E"
                print location "A" . Items["x"]
                print location "A" . Items[true]
        `);
        expect(errors.filter(e => e.includes("indexed by a whole number"))).toHaveLength(2);
    });

    test("`on change` of one item", async () => {
        const errors = await errorsFor(`${WORLD}
            location "B"
                on change location "A" . Items[0] do
                    print 1
                end
        `);
        expect(errors.some(e => e.includes("'on change' watches a whole variable"))).toBe(true);
    });
});

describe("`objective \"X\"` as a chain head", () => {
    test("read, `set`, fields and an alias link", async () => {
        expect(await errorsFor(`${WORLD}
            event "E"
                print objective "Find it" . Status
                print objective "Find it" . name
                set objective "Find it" . Status = "Completed"
                let o = objective "Find it"
                print o . Status
        `)).toEqual([]);
    });

    test("`on change objective \"X\" . Status` is a legal handler target", async () => {
        expect(await errorsFor(`${WORLD}
            location "B"
                on change objective "Find it" . Status to "Completed" do
                    print 1
                end
        `)).toEqual([]);
    });

    test("`objective completed \"X\"` is still the expression, not a head", async () => {
        expect(await errorsFor(`${WORLD}
            event "E"
                when objective completed "Find it" do
                    print 1
                end
        `)).toEqual([]);
    });

    test("a made-up objective name is a linking error", async () => {
        const errors = await errorsFor(`${WORLD}
            event "E"
                print objective "Nope" . Status
        `);
        expect(errors.some(e => e.includes("Nope"))).toBe(true);
    });

    test("member completion after `objective \"X\" .` offers Status", async () => {
        const marked = `${WORLD}
            event "E"
                print objective "Find it" . <|>`;
        const offset = marked.indexOf("<|>");
        const { services, document } = await open(marked.replace("<|>", ""), false);
        const list = await services.lsp.CompletionProvider!.getCompletion(document, {
            textDocument: { uri: document.textDocument.uri },
            position: document.textDocument.positionAt(offset),
        });
        expect((list?.items ?? []).map(i => i.label)).toEqual(expect.arrayContaining(["Status", "name", "description"]));
    });
});
