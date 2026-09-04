import { Controller, Get, Query, StreamableFile, NotFoundException } from '@nestjs/common';
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

    let fileName: string | undefined
    try {
      const locationImageMapper = JSON.parse(fs.readFileSync(mapperFilePath, "utf-8"))
      fileName = locationImageMapper[location]
    } catch {
      throw new NotFoundException(`No map image configured for adventure "${adventure}"`)
    }

    if (!fileName) {
      throw new NotFoundException(`No map image configured for location "${location}"`)
    }

    const imagePath = join(adventurePath, `Maps`, location, fileName)
    if (!fs.existsSync(imagePath)) {
      throw new NotFoundException(`Map image file not found for location "${location}"`)
    }

    const file = createReadStream(imagePath)
    const fileType = fileName.split('.').pop()
    let response = new StreamableFile(file)
    response.options.type=`image/${fileType}`
    return response;
  }
}
