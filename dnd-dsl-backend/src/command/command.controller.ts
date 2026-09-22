import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { CommandService } from './command.service.js';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands.js';

@Controller('command')
export class CommandController {
  constructor(private readonly commandService: CommandService) {}

  @Post('execute')
  execute(@Body() cmd: Command): Promise<CommandResponse> {
    return this.runOrThrow400(() => this.commandService.execute(cmd));
  }

  // The client-generated id identifying which page is asking.
  // CommandService checks it against StateSyncGateway's current controller before allowing the rewind.
  @Post('undo')
  undo(@Headers('x-client-id') clientId: string): Promise<CommandResponse> {
    return this.runOrThrow400(async () => this.commandService.undo(clientId));
  }

  @Post('redo')
  redo(@Headers('x-client-id') clientId: string): Promise<CommandResponse> {
    return this.runOrThrow400(async () => this.commandService.redo(clientId));
  }

  // CommandService throws plain Errors for client-fixable problems.
  private async runOrThrow400<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Error) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
