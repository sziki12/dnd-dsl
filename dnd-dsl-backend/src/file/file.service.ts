import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service.js';

@Injectable()
export class FileService {
    constructor(
            private readonly configurationService: ConfigurationService
          ) { }

    getDnDFilePath(adventure: string, world: string): string
    {
        const dndFilePath = `${this.configurationService.DefaultFilePath}/${adventure}/${world}.dnd`
        return dndFilePath
    }

    getLayoutFilePath(adventure: string, world: string): string
    {
        return `${this.configurationService.DefaultFilePath}/${adventure}/${world}.layout.json`
    }
}
