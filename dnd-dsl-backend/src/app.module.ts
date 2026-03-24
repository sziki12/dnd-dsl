import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { ParsingModule } from './parsing/parsing.module.js';

@Module({
  imports: [ParsingModule],
  controllers: [AppController],
  providers: [AppService, LangiumParserService],
})
export class AppModule {}
