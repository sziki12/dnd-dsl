import { Body, Controller, Post } from '@nestjs/common';
import { CommandService } from './command.service.js';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands.js';

@Controller('command')
export class CommandController {
  constructor(private readonly commandService: CommandService) {}

  @Post('execute')
  execute(@Body() cmd: Command): CommandResponse {
    return this.commandService.execute(cmd);
  }

  @Post('undo')
  undo(): CommandResponse {
    return this.commandService.undo();
  }

  @Post('redo')
  redo(): CommandResponse {
    return this.commandService.redo();
  }
}
