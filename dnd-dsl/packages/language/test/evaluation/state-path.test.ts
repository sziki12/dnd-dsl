import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { Model } from "../../src/generated/ast.js";
import { createDndDslServices } from "../../src/dnd-dsl-module.js";
import {
    decodeStatePath,
    encodeStatePath,
    nodeToStatePath,
    statePathToNode,
    type StatePath,
} from "../../src/evaluation/dnd-dsl-state-path.js";

let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(async () => {
    const services = createDndDslServices(EmptyFileSystem);
    parse = parseHelper<Model>(services.DndDsl);
});

async function parseModel(input: string): Promise<Model> {
    const document = await parse(input, { validation: true });
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    if (errors.length > 0) throw new Error('Unexpected validation errors: ' + errors.map(e => e.message).join(', '));
    return document.parseResult.value;
}

const FIXTURE = `
    world "Test"

    location "High Castle"
        let DangerLevel = 5
        let Resources = object
            let Gold = 2000
        end
        sublocations
            location "Dungeon"
                let Torches = 3
        end

    quest "Rising Dead"
        objective "Find the tomb"

    event "Ambush"

    function calc
    return 1
`;

describe('StatePath round-trip', () => {

    test('top-level Location variable', async () => {
        const model = await parseModel(FIXTURE);
        const decl = model.World.locations[0].variables[0]; // DangerLevel
        const path = nodeToStatePath(decl);
        expect(path).toEqual<StatePath>([
            { kind: 'location', name: 'High Castle' },
            { kind: 'variable', target: 'DangerLevel' },
        ]);
        expect(statePathToNode(model, path!)).toBe(decl);
    });

    test('nested ObjectDeclaration property', async () => {
        const model = await parseModel(FIXTURE);
        // Resources' value isn't the ObjectDeclaration directly — Langium's "infers
        // Expression" grammar chain wraps it in passthrough Expression nodes first —
        // so fetch it through statePathToNode, which already unwraps that.
        const resourcesPath: StatePath = [{ kind: 'location', name: 'High Castle' }, { kind: 'variable', target: 'Resources' }];
        const objectDecl = statePathToNode(model, resourcesPath) as any; // ObjectDeclaration
        const goldDecl = objectDecl.variables[0]; // Gold
        const path = nodeToStatePath(goldDecl);
        expect(path).toEqual<StatePath>([
            { kind: 'location', name: 'High Castle' },
            { kind: 'variable', target: 'Resources' },
            { kind: 'variable', target: 'Gold' },
        ]);
        expect(statePathToNode(model, path!)).toBe(goldDecl);
    });

    test('variable inside a nested sublocation', async () => {
        const model = await parseModel(FIXTURE);
        const dungeon = model.World.locations[0].sublocations[0];
        const torchesDecl = dungeon.variables[0];
        const path = nodeToStatePath(torchesDecl);
        expect(path).toEqual<StatePath>([
            { kind: 'location', name: 'Dungeon' },
            { kind: 'variable', target: 'Torches' },
        ]);
        expect(statePathToNode(model, path!)).toBe(torchesDecl);
    });

    test('Objective (nested under its Quest)', async () => {
        const model = await parseModel(FIXTURE);
        const objective = model.World.quests[0].objectives[0];
        const path = nodeToStatePath(objective);
        expect(path).toEqual<StatePath>([
            { kind: 'objective', questName: 'Rising Dead', name: 'Find the tomb' },
        ]);
        expect(statePathToNode(model, path!)).toBe(objective);
    });

    test('Event', async () => {
        const model = await parseModel(FIXTURE);
        const event = model.World.events[0];
        const path = nodeToStatePath(event);
        expect(path).toEqual<StatePath>([{ kind: 'event', name: 'Ambush' }]);
        expect(statePathToNode(model, path!)).toBe(event);
    });

    test('FunctionDeclaration', async () => {
        const model = await parseModel(FIXTURE);
        const fn = model.World.functions[0];
        const path = nodeToStatePath(fn);
        expect(path).toEqual<StatePath>([{ kind: 'function', name: 'calc' }]);
        expect(statePathToNode(model, path!)).toBe(fn);
    });

    test('encode/decode round-trips through JSON', () => {
        const path: StatePath = [
            { kind: 'location', name: 'High Castle' },
            { kind: 'variable', target: 'Resources' },
            { kind: 'variable', target: 'Gold' },
        ];
        expect(decodeStatePath(encodeStatePath(path))).toEqual(path);
    });

    test('statePathToNode returns undefined for a renamed/removed variable', async () => {
        const model = await parseModel(FIXTURE);
        const path: StatePath = [
            { kind: 'location', name: 'High Castle' },
            { kind: 'variable', target: 'DoesNotExist' },
        ];
        expect(statePathToNode(model, path)).toBeUndefined();
    });

    test('nodeToStatePath returns undefined for a CodeBlock-local variable', async () => {
        const model = await parseModel(`
            world "Test"
            function calc
            let temp = 1
            return temp
        `);
        const localDecl = model.World.functions[0].codeBlock!.code[0] as any; // VariableDeclaration 'temp'
        expect(nodeToStatePath(localDecl)).toBeUndefined();
    });

});
