import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { pathToFileURL } from 'url';
import { LangiumInterpreterService } from './langium-interpreter/langium-interpreter.service.js';
import { ConfigurationService } from './configuration/configuration.service.js';
import { FileService } from './file/file.service.js';
import { WorldStateService } from './world-state/world-state.service.js';
import type { SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly parserService: LangiumParserService,
    private readonly interpreterService: LangiumInterpreterService,
    private readonly configurationService: ConfigurationService,
    private readonly fileService: FileService,
    private readonly worldStateService: WorldStateService,
  ) {
    configurationService.readConfig()
  }

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  @Post('/state/parse')
  async parseLanguage(@Query('adventure') adventure: string, @Query('world') world: string) {
    await this.worldStateService.loadFromFile(this.fileService.getDnDFilePath(adventure, world))
    return 'Model generated successfully'
  }

  @Post('/execute')
  async executeLanguage() {
    const fileUrl = pathToFileURL('./language-output/generated.js').href + `?update=${Date.now()}`
    const generatedModule = await import(fileUrl)
    return generatedModule
  }

  @Get('/state/load')
  async loadLocations() {
    const state = this.worldStateService.getWorldState()
    if (!state || Object.keys(state).length === 0) return undefined
    return state
  }

  @Post('/declare/:name/:value')
  async declare(@Param() params: any) {
    const state = this.worldStateService.getWorldState()
    state[params.name] = params.value
    this.worldStateService.setWorldState(state)
    return state
  }

  @Get('/world')
  async getWorldState() {
    return this.worldStateService.getWorldState()
  }

  @Post('/resolve')
  async resolveReference(@Body() reference: SerializedRef) {
    return this.worldStateService.resolveReference(reference)
  }
}
