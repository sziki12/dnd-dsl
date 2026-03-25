import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, LangiumParserService],
})
export class AppModule {}
