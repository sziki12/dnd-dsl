import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { LangiumInterpreterService } from './langium-interpreter/langium-interpreter.service.js';
import { LangiumConnectionGateway } from './langium-connection/langium-connection.service.js';
import { FileController } from './file/file.controller.js';
import { ConfigurationService } from './configuration/configuration.service.js';

@Module({
  imports: [],
  controllers: [AppController, FileController],
  providers: [AppService, LangiumParserService, LangiumInterpreterService, LangiumConnectionGateway, ConfigurationService],
})
export class AppModule {}
