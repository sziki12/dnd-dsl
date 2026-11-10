import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class FileService {
    constructor(
            private readonly settingsService: SettingsService
          ) { }

    getDnDFilePath(adventure: string, world: string): string
    {
        return `${this.settingsService.requireSourceFolder()}/${adventure}/${world}.dnd`
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
