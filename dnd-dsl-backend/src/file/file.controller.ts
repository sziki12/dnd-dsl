import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import fs from "fs"
import { type FileDto } from "./dto/save-file.dto.js"
import { ConfigurationService } from '../configuration/configuration.service.js';

@Controller('file')
export class FileController {

    constructor(
        private readonly configurationService: ConfigurationService
      ) {}

    @Post('save')
    saveFile(@Body() dto: FileDto): { success: boolean } {
        fs.writeFileSync(`${this.configurationService.DefaultFilePath}/${dto.name}`, dto.content, 'utf-8');
        return { success: true };
    }

    @Get('load')
    sloadFile(@Query('name') name: string): FileDto {
        const fileContent = fs.readFileSync(`${this.configurationService.DefaultFilePath}/${name}`, 'utf-8');
        console.log("Loaded")
        return { content: fileContent, name: name };
    }
}
