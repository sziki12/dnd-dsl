import type { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { URI } from 'langium';
import type { Diagnostic } from 'vscode-languageserver-types';

/** Thrown instead of calling `process.exit(1)` when a `.dnd` document has
 *  error-severity diagnostics, so a long-running host (e.g. a NestJS request
 *  handler) can turn this into an HTTP error response instead of dying. */
export class DndDslParseError extends Error {
    constructor(message: string, public readonly diagnostics: Diagnostic[]) {
        super(message);
        this.name = 'DndDslParseError';
    }
}

export async function extractDocument(fileName: string, services: LangiumCoreServices): Promise<LangiumDocument> {
    const extensions = services.LanguageMetaData.fileExtensions;
    if (!extensions.includes(path.extname(fileName))) {
        throw new Error(`Please choose a file with one of these extensions: ${extensions}.`);
    }

    if (!fs.existsSync(fileName)) {
        throw new Error(`File ${fileName} does not exist.`);
    }

    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(path.resolve(fileName)));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

    const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);
    if (validationErrors.length > 0) {
        throw new DndDslParseError('DSL validation failed', validationErrors);
    }

    return document;
}

export async function extractAstNode<T extends AstNode>(fileName: string, services: LangiumCoreServices): Promise<T> {
    return (await extractDocument(fileName, services)).parseResult?.value as T;
}

interface FilePathData {
    destination: string,
    name: string
}

export function extractDestinationAndName(filePath: string, destination: string | undefined): FilePathData {
    filePath = path.basename(filePath, path.extname(filePath)).replace(/[.-]/g, '');
    return {
        destination: destination ?? path.join(path.dirname(filePath), 'generated'),
        name: path.basename(filePath)
    };
}

export function writeToFile(destinationFolder: string, fileName: string, data: string): string{
    if (!fs.existsSync(destinationFolder)) {
        fs.mkdirSync(destinationFolder, { recursive: true });
    }
    const filePath = `${path.join(destinationFolder, fileName)}`;
    fs.writeFileSync(filePath, data);
    return filePath
}
