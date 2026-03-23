import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import fs = require('fs');

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly parserService: LangiumParserService ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("/language")
  async getLanguage() {
    const text = fs.readFileSync(('C:\\Users\\Szikszai Levente\\Documents\\GitHub\\dnd-dsl\\dnd-dsl-backend\\test_file.dnd'), 'utf8');
    let resultContent = await this.parserService.parse(text);
    //fs.writeFileSync("out/generated.js", resultContent);
    return "Parsed";
  }
}
