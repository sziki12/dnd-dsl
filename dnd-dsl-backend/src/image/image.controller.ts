import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service.js';
import fs, { createReadStream } from "fs"
import { join } from 'path';

@Controller('image')
export class ImageController {
    
    world: string = ""
    adventure: string = ""
    constructor(
        private readonly configurationService: ConfigurationService
      ) {
        this.world = configurationService.WorldName!
        this.adventure = configurationService.AdventureName!
      }

    @Get('load')
    loadImage(@Query('adventure') adventure: string, @Query('location') location: string): StreamableFile {
    
    const adventurePath = join(this.configurationService.DefaultFilePath!, adventure)
    const mapperFilePath = join(adventurePath, "Maps.json")

    const locationImageMapper = JSON.parse(fs.readFileSync(mapperFilePath, "utf-8"))
    const fileName: string = locationImageMapper[location]

    const file = createReadStream(join(adventurePath, `Maps`, location, fileName))
    const fileType = fileName.split('.').pop()
    let response = new StreamableFile(file)
    response.options.type=`image/${fileType}`
    return response;
  }
}
