import { Controller, Get, Post, Param, Query, Body, HttpCode } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { pathToFileURL } from 'url';
import { LangiumInterpreterService } from './langium-interpreter/langium-interpreter.service.js';
import { ConfigurationService } from './configuration/configuration.service.js';
import { FileService } from './file/file.service.js';
import { WorldStateService } from './world-state/world-state.service.js';
import { CommandService } from './command/command.service.js';
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
    private readonly commandService: CommandService,
  ) {
    configurationService.readConfig()
  }

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  @Post('/parse')
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

  @Get('/world/functions')
  getFunctions() {
    return this.worldStateService.getFunctions()
  }

  @Post('/world/functions/:name')
  callFunction(@Param('name') name: string, @Body() body: { args?: any[] }) {
    return this.commandService.execute({ type: 'CALL_FUNCTION', functionName: name, args: body.args ?? [] })
  }

  @Get('/world/events')
  getEvents() {
    return this.worldStateService.getEvents()
  }

  @Post('/world/events/:name')
  triggerEvent(@Param('name') name: string) {
    return this.commandService.execute({ type: 'TRIGGER_EVENT', eventName: name })
  }

  @Post('/resolve')
  @HttpCode(200)
  async resolveReference(@Body() reference: SerializedRef) {
    //console.log('Resolving reference via controller:', reference)
    return this.worldStateService.resolveReference(reference)
  }
}
