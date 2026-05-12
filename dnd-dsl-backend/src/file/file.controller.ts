import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import fs from "fs"
import { type FileDto } from "./dto/save-file.dto.js"
import { ConfigurationService } from '../configuration/configuration.service.js';
import { FileService } from './file.service.js';

@Controller('file')
export class FileController {
    
    world: string = ""
    adventure: string = ""
    constructor(
        private readonly configurationService: ConfigurationService,
        private readonly fileService: FileService
      ) {
        this.world = configurationService.WorldName!
        this.adventure = configurationService.AdventureName!
      }

    @Post('save')
    saveDnDFile(@Body() dto: FileDto): { success: boolean } {
        const dndFilePath = this.fileService.getDnDFilePath(dto.identifier.adventure, dto.identifier.world)
        fs.writeFileSync(`${dndFilePath}`, dto.content, 'utf-8');
        return { success: true };
    }

    @Get('load')
    loadDnDFile(@Query('adventure') adventure: string, @Query('world') world: string): FileDto {
        const dndFilePath = this.fileService.getDnDFilePath(adventure, world)
        const fileContent = fs.readFileSync(`${dndFilePath}`, 'utf-8');
        console.log("Loaded")
        return { content: fileContent, identifier:{adventure, world} };
    }
}
