import { Injectable } from '@nestjs/common';
import { DndDslAstType , Model} from '@dnd-language/generated/ast.js';
import { createDndDslServices } from '../dnd-language/language/src/dnd-dsl-module.js';
import { generateJavaScript} from '../dnd-language/cli/src/generator.js';
import { EmptyFileSystem, LangiumParser, URI } from 'langium';

@Injectable()
export class LangiumParserService {
    private services;

  constructor() {
    // Initialize your language services
    this.services = createDndDslServices(EmptyFileSystem).DndDsl;
  }

  async parseAndGenerate(input: string) {
     const documentBuilder = this.services.shared.workspace.DocumentBuilder;
    const documentFactory = this.services.shared.workspace.LangiumDocumentFactory;
    const documents = this.services.shared.workspace.LangiumDocuments;

    // 1. Virtuális dokumentum létrehozása a string inputból
    const uri = URI.parse('memory://generated/input.dnd');
    const document = documentFactory.fromString(input, uri);
    
    // 2. Regisztrálni kell a workspace-be
    documents.addDocument(document);
    
    // 3. Teljes build pipeline futtatása – ez végzi el a linking-et!
    await documentBuilder.build([document], { validation: true });
    
    // 4. Parser hibák ellenőrzése
    const parserErrors = document.parseResult.parserErrors;
    if (parserErrors.length > 0) {
        const messages = parserErrors.map(e => e.message).join(', ');
        throw new Error(`Parser errors: ${messages}`);
    }
    
    // 5. Linkelési / validációs hibák ellenőrzése
    const validationErrors = document.diagnostics?.filter(d => d.severity === 1) ?? [];
    if (validationErrors.length > 0) {
        const messages = validationErrors.map(e => e.message).join(', ');
        throw new Error(`Validation errors: ${messages}`);
    }
    
    // 6. Most már biztonságos a model használata
    const model = document.parseResult.value as Model;
    
    await generateJavaScript(model, "./generated.js", "language-output");
    //await generateWorldState(model, "./worldstate.js", "language-output");
    
    // 7. Cleanup – ha többször hívod, ne halmozódjon fel
    documents.deleteDocument(uri);
    return;
  }

async parse(input: string) {
    const parser : LangiumParser = this.services.parser.LangiumParser;
    const result = parser.parse(input);
    
    if (result.parserErrors && result.parserErrors.length > 0) {
      const messages = result.parserErrors.map(e => e.message).join(', ');
      throw new Error(`Parser errors: ${messages}`);
    }
    return result.value;
  }
}
