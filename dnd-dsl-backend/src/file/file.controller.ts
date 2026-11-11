import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import fs from "fs"
import { basename } from "path"
import { type FileDto } from "./dto/save-file.dto.js"
import { FileService } from './file.service.js';
import { WorldStateService } from '../world-state/world-state.service.js';
import { StateSyncGateway } from '../state-sync/state-sync.gateway.js';
import { EMPTY_STATE_OVERLAY, type StateOverlayFile } from '../world-state/state-overlay.types.js';
import { isSafeSegment, readMapView, writeMapView, type MapViewEntry } from './map-view-store.js';
import { readLayout, writeLayout, type Layout } from './layout-store.js';

@Controller('file')
export class FileController {

    constructor(
        private readonly fileService: FileService,
        private readonly worldStateService: WorldStateService,
        private readonly stateSyncGateway: StateSyncGateway,
      ) {}

    // A world is one file or several (see adventure-store.ts); `file` names one of them and may be left out for one file.
    @Get('list')
    listFiles(@Query('adventure') adventure: string, @Query('world') world: string): { kind: 'file' | 'folder'; files: string[] } {
        const { kind, files } = this.fileService.getWorldFiles(adventure, world)
        return { kind, files: files.map(file => basename(file)) };
    }

    @Get('adventure')
    adventureFiles(@Query('adventure') adventure: string) {
        return { worlds: this.fileService.readAdventureFiles(adventure) };
    }

    @Post('save')
    saveDnDFile(@Body() dto: FileDto): { success: boolean } {
        const dndFilePath = this.fileService.getWorldFilePath(dto.identifier.adventure, dto.identifier.world, dto.file)
        fs.writeFileSync(`${dndFilePath}`, dto.content, 'utf-8');
        this.stateSyncGateway.broadcastFilesChanged();
        return { success: true };
    }

    @Get('load')
    loadDnDFile(@Query('adventure') adventure: string, @Query('world') world: string, @Query('file') file?: string): FileDto {
        const dndFilePath = this.fileService.getWorldFilePath(adventure, world, file)
        const fileContent = fs.readFileSync(`${dndFilePath}`, 'utf-8');
        return { content: fileContent, identifier:{adventure, world}, file: basename(dndFilePath) };
    }

    @Post('new')
    newFile(@Body() body: { adventure: string; world: string; file: string }): { file: string } {
        const file = this.fileService.addWorldFile(body?.adventure, body?.world, body?.file);
        this.stateSyncGateway.broadcastFilesChanged();
        return { file };
    }

    @Post('layout/save')
    saveLayout(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
        @Body() positions: Layout
    ): { success: boolean } {
        writeLayout(this.fileService.getLayoutFilePath(adventure, world), location, positions);
        return { success: true };
    }

    @Get('layout/load')
    loadLayout(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
    ): Layout {
        return readLayout(this.fileService.getLayoutFilePath(adventure, world), location);
    }

    // Map view settings (colours, labels, node size, ...) per location. An empty body clears the location's entry.
    @Post('view/save')
    saveView(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
        @Body() settings: MapViewEntry,
    ): { success: boolean } {
        writeMapView(this.viewFilePath(adventure, world), location, settings);
        return { success: true };
    }

    @Get('view/load')
    loadView(
        @Query('adventure') adventure: string,
        @Query('world') world: string,
        @Query('location') location: string,
    ): MapViewEntry {
        return readMapView(this.viewFilePath(adventure, world), location);
    }

    private viewFilePath(adventure: string, world: string): string {
        if (!isSafeSegment(adventure) || !isSafeSegment(world)) throw new BadRequestException('Invalid adventure or world.');
        return this.fileService.getViewFilePath(adventure, world);
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
