import { Controller, Get, Post, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { pathToFileURL } from 'url';
import { LangiumInterpreterService } from './langium-interpreter/langium-interpreter.service.js';
import { FileService } from './file/file.service.js';
import { WorldStateService } from './world-state/world-state.service.js';
import { CommandService } from './command/command.service.js';
import { DndDslParseError } from '@dnd-cli/main.js';
import { AdventureService } from './adventure/adventure.service.js';
import { AdventureError } from './adventure/adventure-store.js';
import { WorldRegistry } from './adventure/world-registry.service.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly parserService: LangiumParserService,
    private readonly interpreterService: LangiumInterpreterService,
    private readonly fileService: FileService,
    private readonly worldStateService: WorldStateService,
    private readonly commandService: CommandService,
    private readonly adventureService: AdventureService,
    private readonly worldRegistry: WorldRegistry,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  @Post('/parse')
  async parseLanguage(@Query('adventure') adventure: string, @Query('world') world: string) {
    try {
      await this.worldStateService.loadFromFiles(
        this.fileService.getWorldFiles(adventure, world).files,
        world,
        this.fileService.getStateFilePath(adventure, world),
        this.worldRegistry.preparer(adventure, world),
      )
      this.adventureService.markLoaded(adventure, world)
      this.commandService.notifyWorldReloaded()
      return 'Model generated successfully'
    } catch (e) {
      if (e instanceof DndDslParseError) {
        throw new BadRequestException({ success: false, errors: e.diagnostics.map(d => d.message) })
      }
      if (e instanceof AdventureError) {
        throw new BadRequestException({ success: false, errors: [e.message] })
      }
      throw e
    }
  }

  @Post('/execute')
  async executeLanguage() {
    const fileUrl = pathToFileURL('./language-output/generated.js').href + `?update=${Date.now()}`
    const generatedModule = await import(fileUrl)
    return generatedModule
  }

  @Get('/world')
  async getWorldState() {
    return this.worldStateService.getWorldState()
  }

  @Get('/world/source')
  async getWorldSource() {
    return this.worldStateService.getWorldSource()
  }

  @Get('/world/render')
  async getRenderedWorld() {
    return this.worldStateService.getRenderedWorld().text
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

  @Get('/world/agenda')
  getAgenda() {
    return {
      now: this.worldStateService.getClock(),
      upcoming: this.worldStateService.getReminders(),
      fired: this.worldStateService.getFiredReminders(),
    }
  }

  @Post('/world/events/:name')
  triggerEvent(@Param('name') name: string) {
    return this.commandService.execute({ type: 'TRIGGER_EVENT', eventName: name })
  }
}
