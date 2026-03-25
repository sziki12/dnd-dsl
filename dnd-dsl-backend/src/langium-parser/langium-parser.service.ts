import { Injectable } from '@nestjs/common';
import { DndDslAstType , Model} from '@dnd-language/generated/ast.js';
import { createDndDslServices } from '../dnd-language/language/src/dnd-dsl-module.js';
import { generateJavaScript, generateWorldState} from '../dnd-language/cli/src/generator.js';
import { EmptyFileSystem, LangiumParser } from 'langium';

@Injectable()
export class LangiumParserService {
    private services;

  constructor() {
    // Initialize your language services
    this.services = createDndDslServices(EmptyFileSystem).DndDsl;
  }

  async parseAndGenerate(input: string) {
    const parser : LangiumParser = this.services.parser.LangiumParser;
    const result = parser.parse(input);
    
    if (result.parserErrors && result.parserErrors.length > 0) {
      const messages = result.parserErrors.map(e => e.message).join(', ');
      throw new Error(`Parser errors: ${messages}`);
    }
    await generateJavaScript(result.value as Model, "./generated.js", "language-output");
    await generateWorldState(result.value as Model, "./worldstate.js", "language-output");
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
