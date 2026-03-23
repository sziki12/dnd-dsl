import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { join } from 'path';
import { pathToFileURL } from 'url';
import fs = require('fs');

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly parserService: LangiumParserService ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }


  
  @Get("/generate")
  async generateLanguage() {
    const text = fs.readFileSync(('./test_file.dnd'), 'utf8');
    let resultContent = await this.parserService.parse(text);
    //fs.writeFileSync("out/generated.js", resultContent);
    return "Parsed";
  }

  @Get("/execute")
  async executeLanguage() {
    const fileUrl = pathToFileURL("./language-output/generated.js").href + `?update=${Date.now()}`;
    const generatedModule = await import(fileUrl);

    // 3. Call a function from the generated file
    return generatedModule;
  }
}
