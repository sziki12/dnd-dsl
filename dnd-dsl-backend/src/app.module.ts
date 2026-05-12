import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LangiumParserService } from './langium-parser/langium-parser.service.js';
import { LangiumInterpreterService } from './langium-interpreter/langium-interpreter.service.js';
import { LangiumConnectionGateway } from './langium-connection/langium-connection.service.js';
import { FileController } from './file/file.controller.js';
import { ConfigurationService } from './configuration/configuration.service.js';
import { ImageController } from './image/image.controller.js';
import { LangiumExportService } from './langium-export/langium-export.service.js';
import { FileService } from './file/file.service.js';
import { ImageService } from './image/image.service.js';

@Module({
  imports: [],
  controllers: [AppController, FileController, ImageController],
  providers: [AppService, LangiumParserService, LangiumInterpreterService, LangiumConnectionGateway, ConfigurationService, LangiumExportService, FileService, ImageService],
})
export class AppModule {}
