import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { addWorldFile, worldFilePath, worldFiles, type WorldFiles } from '../adventure/adventure-store.js';

@Injectable()
export class FileService {
    constructor(
            private readonly settingsService: SettingsService
          ) { }

    /** The files the world is written in (one, or the parts in its folder). */
    getWorldFiles(adventure: string, world: string): WorldFiles
    {
        return worldFiles(this.settingsService.requireSourceFolder(), { adventure, world })
    }

    /** One of the world's files by name, or its only file when no name is given. */
    getWorldFilePath(adventure: string, world: string, file?: string): string
    {
        return worldFilePath(this.settingsService.requireSourceFolder(), { adventure, world }, file)
    }

    /** Adds a file to the world (turning a one-file world into a folder) and returns its name. */
    addWorldFile(adventure: string, world: string, file: string): string
    {
        return addWorldFile(this.settingsService.requireSourceFolder(), { adventure, world }, file)
    }

    getLayoutFilePath(adventure: string, world: string): string
    {
        return `${this.settingsService.requireSourceFolder()}/${adventure}/${world}.layout.json`
    }

    getViewFilePath(adventure: string, world: string): string
    {
        return `${this.settingsService.requireSourceFolder()}/${adventure}/${world}.mapview.json`
    }

    getStateFilePath(adventure: string, world: string): string
    {
        return `${this.settingsService.requireSourceFolder()}/${adventure}/${world}.state.json`
    }
}
