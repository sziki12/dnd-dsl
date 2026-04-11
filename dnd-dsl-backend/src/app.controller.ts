import { Controller, Get, Post, Param } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { pathToFileURL } from 'url';
import { Model } from '@dnd-language/index.js';
import { parseModel, stringifyModel } from '@dnd-cli/main.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly parserService: LangiumParserService,
  ) {}

  private worldState : any = {};
  private model : Model | undefined = undefined;
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }


  
  @Post("/generate")
  async generateLanguage() {
    this.model = (await parseModel('./test_file.dnd'));
    return "Model generated successfully";
  }

  @Post("/execute")
  async executeLanguage() {
    const fileUrl = pathToFileURL("./language-output/generated.js").href + `?update=${Date.now()}`;
    const generatedModule = await import(fileUrl);

    return generatedModule;
  }

  @Post("/load/locations")
  async loadLocations() {
    if(this.model === undefined)
      return

    const fileUrl = pathToFileURL("./language-output/worldstate.js").href + `?update=${Date.now()}`;
    const worldStetModule = await import(fileUrl);
    this.worldState = JSON.parse(stringifyModel(this.model));
    
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
