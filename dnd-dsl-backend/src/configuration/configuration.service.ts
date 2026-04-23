import { Injectable } from '@nestjs/common';
import fs from "fs"

@Injectable()
export class ConfigurationService {
    configPath = "./config/config.json"
    DefaultFilePath: string | undefined

    readConfig()
    {
        const fileContent = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(fileContent)
        this.DefaultFilePath = config.DefaultFilePath
    }
}
