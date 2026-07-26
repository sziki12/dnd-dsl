import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CommandService } from './command.service.js';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands.js';

@Controller('command')
export class CommandController {
  constructor(private readonly commandService: CommandService) {}

  @Post('execute')
  execute(@Body() cmd: Command): CommandResponse {
    return this.runOrThrow400(() => this.commandService.execute(cmd));
  }

  @Post('undo')
  undo(): CommandResponse {
    return this.runOrThrow400(() => this.commandService.undo());
  }

  @Post('redo')
  redo(): CommandResponse {
    return this.runOrThrow400(() => this.commandService.redo());
  }

  // CommandService throws plain Errors for client-fixable problems (unresolved
  // StatePath, assigning to a computed variable, no model loaded yet, ...).
  // Without this, Nest's default filter flattens them into an opaque
  // "Internal server error" 500 and the real reason only shows up server-side.
  private runOrThrow400<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
