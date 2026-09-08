import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CommandService } from './command.service.js';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands.js';

@Controller('command')
export class CommandController {
  constructor(private readonly commandService: CommandService) {}

  @Post('execute')
  execute(@Body() cmd: Command): Promise<CommandResponse> {
    return this.runOrThrow400(() => this.commandService.execute(cmd));
  }

  @Post('undo')
  undo(): Promise<CommandResponse> {
    return this.runOrThrow400(async () => this.commandService.undo());
  }

  @Post('redo')
  redo(): Promise<CommandResponse> {
    return this.runOrThrow400(async () => this.commandService.redo());
  }

  // CommandService throws plain Errors for client-fixable problems (unresolved
  // StatePath, a script parse/runtime failure, no model loaded yet, ...).
  // Without this, Nest's default filter flattens them into an opaque
  // "Internal server error" 500 and the real reason only shows up server-side.
  private async runOrThrow400<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Error) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
