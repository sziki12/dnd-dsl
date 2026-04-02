import { Controller, Get, Post, Param } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { join } from 'path';
import { pathToFileURL } from 'url';
import fs = require('fs');
import { Model } from '@dnd-language/index.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly parserService: LangiumParserService,
  ) {}

  private worldState = {};
  private parsed : Model;
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }


  
  @Post("/generate")
  async generateLanguage() {
    const text = fs.readFileSync(('./test_file.dnd'), 'utf8');
    await this.parserService.parseAndGenerate(text);
    return "Parsed";
  }

  @Post("/execute")
  async executeLanguage() {
    const fileUrl = pathToFileURL("./language-output/generated.js").href + `?update=${Date.now()}`;
    const generatedModule = await import(fileUrl);

    return generatedModule;
  }

  @Post("/load/locations")
  async loadLocations() {
    const fileUrl = pathToFileURL("./language-output/worldstate.js").href + `?update=${Date.now()}`;
    const worldStetModule = await import(fileUrl);
    this.worldState = worldStetModule["getWorldState"]();
    
    this.worldState["functions"] = []
    this.worldState["functions"]["Random"] = (min, max) => {return Math.random()*(max-min)+min}

    console.log(this.worldState["functions"]["Random"](10,20))
    worldStetModule["initWorldState"](this.worldState);
    return this.worldState;
  }

  @Post("/declare/:name/:value")
  async declare(@Param() params: any) {
    this.worldState[params.name] = params.value
    return this.worldState;
  }

  @Get("/world")
  async getWorldState() {
    return this.worldState;
  }
}
