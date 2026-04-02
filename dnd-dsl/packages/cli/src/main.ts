import type { Model } from '../../language/src/generated/ast.js';
import { createDndDslServices } from '../../language/src/dnd-dsl-module.js';
import { DndDslLanguageMetaData } from '../../language/src/generated/module.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractDocument } from './util.js';
import { generateJavaScript, /*generateWorldState*/ } from './generator.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createDndDslServices(NodeFileSystem).DndDsl;
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
        console.error(chalk.red("Linking errors found:"));
        errors.forEach(e => console.error(chalk.red(` - ${e.message}`)));
        process.exit(1);
    }
    
    // 4. Most már biztonságos a model kinyerése
    const model = document.parseResult.value as Model;
    
    const generatedFilePath = generateJavaScript(model, fileName, opts.destination);
    console.log(chalk.green(`JavaScript code generated successfully: ${generatedFilePath}`));

    //const generatedWorldStateFilePath = generateWorldState(model, fileName, opts.destination);
    //console.log(chalk.green(`WordlState generated successfully: ${generatedWorldStateFilePath}`));
};

export type GenerateOptions = {
    destination?: string;
}

export default function(): void {
    const program = new Command();

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
