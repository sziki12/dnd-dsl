import type { Model } from '../../language/src/generated/ast.js';
import { createDndDslServices, DndDslServices } from '../../language/src/dnd-dsl-module.js';
import { DndDslLanguageMetaData } from '../../language/src/generated/module.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractDocument, DndDslParseError } from './util.js';
import { generateJavaScript, /*generateWorldState*/ } from './generator.js';
import { NodeFileSystem } from 'langium/node';
import { registerBuiltinDocument } from '../../language/src/builtin-documents.js';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AstNode, URI } from 'langium';
import type { Diagnostic } from 'vscode-languageserver-types';
import { mergeWorldFiles, type MergedWorld } from '../../language/src/world-files.js';
import { checkForeignReferences, foreignWorldNames, type ForeignWorlds } from '../../language/src/evaluation/dnd-dsl-foreign.js';

export { DndDslParseError };

export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    var model: Model = await parseModel(fileName);
    
    const generatedFilePath = generateJavaScript(model, fileName, opts.destination);
    console.log(chalk.green(`JavaScript code generated successfully: ${generatedFilePath}`));

    //const generatedWorldStateFilePath = generateWorldState(model, fileName, opts.destination);
    //console.log(chalk.green(`WordlState generated successfully: ${generatedWorldStateFilePath}`));
};

export const parseModelAndStringify = async (fileName: string): Promise<string> => {
    const services = createDndDslServices(NodeFileSystem).DndDsl;
    var model: Model = await parseModel(fileName, services);

    return stringifyNode(model, services);
}

export const stringifyNode = (node: AstNode, paramServices: DndDslServices | undefined = undefined): string => {
    const services = paramServices || createDndDslServices(NodeFileSystem).DndDsl;

    const jsonSerializer = services.serializer.JsonSerializer;
    // refText keeps a reference's name in the JSON, which is the only way to name a target in another document
    // (a built-in state or relation type): its $ref points into that document, not into this model.
    const serializedModel = jsonSerializer.serialize(node, { refText: true });
    return serializedModel;
}

export const parseModel = async (fileName: string, paramServices: DndDslServices | undefined = undefined): Promise<Model> => {
    const services = paramServices || createDndDslServices(NodeFileSystem).DndDsl;
    // Load pre declared objects first: extractDocument already builds and validates the document, so a fact's
    // relation type ("Member of") has to be in the index by then.
    await registerBuiltinDocument(services.shared);

    // 1. Document betöltése
    const document = await extractDocument(fileName, services);

    // 2. Explicitly build-elni kell – ez futtatja a linkert!
    await services.shared.workspace.DocumentBuilder.build(
        [document],
        { validation: true }
    );

    // Ellenőrizd hogy a document properly inicializált
    if (!document.parseResult.value.$document) {
        // Ha ez undefined, a Langium verziód lehet a probléma
        (document.parseResult.value as any).$document = document;
    }
    
    // 3. Ellenőrizd a linkelési hibákat
    const errors = document.diagnostics?.filter(d => d.severity === 1) ?? [];
    if (errors.length > 0) {
        throw new DndDslParseError('DSL validation failed', errors);
    }
    
    // 4. Most már biztonságos a model kinyerése
    const model = document.parseResult.value as Model;
    
    return model;
};



const problemAt = (message: string): Diagnostic => ({
    severity: 1,
    message,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

/**
 * Loads the world `worldName` from its files (see world-files.ts): the files are glued into one source, parsed and
 * checked as one world, and every problem says which file and line it is in. A world of one file is that file.
 * `prepareForeign` is given the other worlds this world mentions and returns their state; with it, every name that
 * points into one of them is checked too.
 */
export const parseWorld = async (
    files: string[],
    worldName: string,
    prepareForeign?: (worlds: string[]) => Promise<ForeignWorlds>,
): Promise<{ model: Model; source: string; foreign?: ForeignWorlds; fileAt: MergedWorld['fileAt'] }> => {
    const services = createDndDslServices(NodeFileSystem).DndDsl;
    await registerBuiltinDocument(services.shared);

    const texts = await Promise.all(files.map(async file => ({ file: path.basename(file), text: await fs.readFile(file, 'utf-8') })));
    const result = mergeWorldFiles(services, worldName, texts);
    if (!result.ok) {
        throw new DndDslParseError('DSL validation failed', result.problems.map(p => problemAt(p.file ? `${p.file}: ${p.message}` : p.message)));
    }
    const { merged } = result;

    const workspace = services.shared.workspace;
    const document = workspace.LangiumDocumentFactory.fromString(merged.text, URI.file(path.resolve(files[0])));
    workspace.LangiumDocuments.addDocument(document);
    await workspace.DocumentBuilder.build([document], { validation: true });

    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    if (errors.length > 0) {
        throw new DndDslParseError('DSL validation failed', errors.map(d => {
            const at = merged.fileAt(d.range.start.line + 1);
            return { ...d, message: `${at.file}:${at.line}: ${d.message}` };
        }));
    }
    if (!document.parseResult.value.$document) {
        (document.parseResult.value as any).$document = document;
    }
    const model = document.parseResult.value as Model;

    const others = prepareForeign ? foreignWorldNames(model, worldName) : [];
    if (!prepareForeign || others.length === 0) return { model, source: merged.text, fileAt: merged.fileAt };

    const foreign = await prepareForeign(others);
    const problems = checkForeignReferences(model, foreign);
    if (problems.length > 0) {
        throw new DndDslParseError('DSL validation failed', problems.map(problem => {
            const at = merged.fileAt((problem.node.$cstNode?.range.start.line ?? 0) + 1);
            return problemAt(`${at.file}:${at.line}: ${problem.message}`);
        }));
    }
    return { model, source: merged.text, foreign, fileAt: merged.fileAt };
};

export type GenerateOptions = {
    destination?: string;
}

export default async function(): Promise<void>  {
    const program = new Command();
    
    const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const packageContent = await fs.readFile(packagePath, 'utf-8');

    program.version(JSON.parse(packageContent).version);

    const fileExtensions = DndDslLanguageMetaData.fileExtensions.join(', ');
    program
        .command('generate')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .option('-d, --destination <dir>', 'destination directory of generating')
        .description('generates JavaScript code that prints "Hello, {name}!" for each greeting in a source file')
        .action(generateAction);

    program.parse(process.argv);
}
