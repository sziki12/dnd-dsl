import { Injectable } from '@nestjs/common';
import { DndDslAstType , Model} from '@dnd-language/generated/ast.js';
import { createDndDslServices } from '../dnd-language/language/src/dnd-dsl-module.js';
import { generateJavaScript} from '../dnd-language/cli/generator.js';
import { EmptyFileSystem, LangiumParser } from 'langium';

@Injectable()
export class LangiumParserService {
    private services;

  constructor() {
    // Initialize your language services
    this.services = createDndDslServices(EmptyFileSystem).DndDsl;
  }

  async parse(input: string) {
    const parser : LangiumParser = this.services.parser.LangiumParser;
    const result = parser.parse(input);
    
    // Replace 'expect' with a standard error check
    if (result.parserErrors && result.parserErrors.length > 0) {
      const messages = result.parserErrors.map(e => e.message).join(', ');
      throw new Error(`Parser errors: ${messages}`);
    }
    const javaScript = await generateJavaScript(result.value as Model, "generated.js", "language-output");
    return;
  }

  /*async parse(input: string) {
    const parser = this.services.parser.LangiumParser;
    const document = await parser(input, {validation: true});

    //Validation
    expect(document.parseResult.lexerErrors).toHaveLength(0);
    expect(document.parseResult.parserErrors).toHaveLength(0);
    expect(document.diagnostics ?? []).toHaveLength(0);

    const javaScript = generateJavaScript(document.parseResult.value, 'C:\\Users\\Szikszai Levente\\Documents\\GitHub\\dnd-dsl\\dnd-dsl-backend\\out', "generated.js");

    return javaScript;
    return "Parsed"
  }*/
}
