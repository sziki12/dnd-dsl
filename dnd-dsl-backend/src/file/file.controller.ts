import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import fs from "fs"
import { type FileDto } from "./dto/save-file.dto.js"
import { ConfigurationService } from '../configuration/configuration.service.js';
import { FileService } from './file.service.js';
import { WorldStateService } from '../world-state/world-state.service.js';
import { EMPTY_STATE_OVERLAY, type StateOverlayFile } from '../world-state/state-overlay.types.js';

@Controller('file')
export class FileController {

    world: string = ""
    adventure: string = ""
    constructor(
        private readonly configurationService: ConfigurationService,
        private readonly fileService: FileService,
        private readonly worldStateService: WorldStateService,
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

    @Post('layout/save')
    saveLayout(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
        @Body() positions: Record<string, { x: number; y: number }>
    ): { success: boolean } {
        const layoutPath = this.fileService.getLayoutFilePath(adventure, world);
        let allLayouts: Record<string, Record<string, { x: number; y: number }>> = {};
        if (fs.existsSync(layoutPath)) {
            allLayouts = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
        }
        allLayouts[location] = positions;
        fs.writeFileSync(layoutPath, JSON.stringify(allLayouts, null, 2), 'utf-8');
        return { success: true };
    }

    @Get('layout/load')
    loadLayout(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
    ): Record<string, { x: number; y: number }> {
        const layoutPath = this.fileService.getLayoutFilePath(adventure, world);
        if (!fs.existsSync(layoutPath)) return {};
        const allLayouts = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
        return allLayouts[location] ?? {};
    }

    @Get('state/load')
    loadState(@Query('adventure') adventure: string, @Query('world') world: string): StateOverlayFile {
        const statePath = this.fileService.getStateFilePath(adventure, world);
        if (!fs.existsSync(statePath)) return EMPTY_STATE_OVERLAY;
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }

    @Post('state/reset')
    resetState(@Query('adventure') adventure: string, @Query('world') world: string): { success: boolean } {
        const statePath = this.fileService.getStateFilePath(adventure, world);
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
        this.worldStateService.resetOverlay();
        return { success: true };
    }
}
