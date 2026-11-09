import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, URI } from "langium";
import { createDndDslServices } from "../src/dnd-dsl-module.js";
import { registerBuiltinDocument } from "../src/builtin-documents.js";

const HEAD = `world "T"

faction "Guards"
faction "Thieves"
npc "First NPC"

function probe
`;
const PREFIX = HEAD + "    print relation ";
const FOR_PREFIX = HEAD + "    for i in relation ";

let services: ReturnType<typeof createDndDslServices>;
let count = 0;

beforeAll(async () => {
    services = createDndDslServices(EmptyFileSystem);
    await registerBuiltinDocument(services.shared);
});

/** The completion labels at the end of `relation <typed>`. */
async function complete(typed: string, prefix = PREFIX): Promise<string[]> {
    const text = prefix + typed;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`memory://relation/${count++}.dnd`));
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    const list = await services.DndDsl.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: document.uri.toString() },
        position: document.textDocument.positionAt(text.length),
    });
    return (list?.items ?? []).map(item => item.label);
}

describe("relation query completion", () => {
    test("the subject kind", async () => {
        expect(await complete("")).toEqual(expect.arrayContaining(["npc", "faction"]));
    });

    describe("named subject: relation npc \"First NPC\" \"Member of\" faction \"Guards\"", () => {
        test("the relation type after the subject", async () => {
            expect(await complete('npc "First NPC" ')).toEqual(["Member of"]);
            expect(await complete('npc "First NPC" "')).toEqual(["Member of"]);
        });
        test("the target kind after the type", async () => {
            expect(await complete('npc "First NPC" "Member of" ')).toEqual(expect.arrayContaining(["npc", "faction"]));
            expect(await complete('npc "First NPC" "Member of" fac')).toEqual(["faction"]);
        });
        test("the target name", async () => {
            expect(await complete('npc "First NPC" "Member of" faction ')).toEqual(["Guards", "Thieves"]);
            expect(await complete('npc "First NPC" "Member of" faction "')).toEqual(["Guards", "Thieves"]);
        });
    });

    describe("open subject: relation npc \"Member of\" faction \"Guards\"", () => {
        test("both the relation type and the subject names after the kind", async () => {
            expect(await complete("npc ")).toEqual(expect.arrayContaining(["Member of", "First NPC"]));
            expect(await complete('npc "Mem')).toEqual(["Member of"]);
        });
        test("the target kind after the type", async () => {
            expect(await complete('npc "Member of" ')).toEqual(["npc", "faction"]);
            expect(await complete('npc "Member of" fac')).toEqual(["faction"]);
        });
        test("the target name", async () => {
            expect(await complete('npc "Member of" faction "')).toEqual(["Guards", "Thieves"]);
        });
    });

    describe("in a for header: for i in relation ...", () => {
        const inFor = (typed: string) => complete(typed, FOR_PREFIX);

        test("a bare target kind offers the names and do", async () => {
            expect(await inFor('npc "First NPC" "Member of" faction ')).toEqual(["Guards", "Thieves", "do"]);
            expect(await inFor('npc "Member of" faction ')).toEqual(["Guards", "Thieves", "do"]);
        });
        test("a partial word after the kind offers do", async () => {
            expect(await inFor('npc "First NPC" "Member of" faction d')).toEqual(["do"]);
            expect(await inFor('npc "Member of" faction d')).toEqual(["do"]);
        });
        test("a complete target offers do", async () => {
            expect(await inFor('npc "First NPC" "Member of" faction "Guards" ')).toEqual(["do"]);
            expect(await inFor('npc "Member of" faction "Guards" ')).toEqual(["do"]);
        });
        test("do is not offered before the query is complete", async () => {
            expect(await inFor('npc "First NPC" ')).toEqual(["Member of"]);
            expect(await inFor('npc "Member of" ')).toEqual(["npc", "faction"]);
        });
    });
});
