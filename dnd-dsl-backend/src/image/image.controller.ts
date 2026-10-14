import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import type { IncomingMessage } from 'http';
import { join } from 'path';
import { isSafeSegment } from '../common/safe-segment.js';
import { ConfigurationService } from '../configuration/configuration.service.js';
import { MAX_IMAGE_BYTES, contentTypeFor, isImageUploadType, readBody, resolveMapImage, saveMapImage } from './map-image-store.js';

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

    private adventurePath(adventure: string): string {
      if (!isSafeSegment(adventure)) throw new BadRequestException('Invalid adventure.')
      return join(this.configurationService.DefaultFilePath!, adventure)
    }

    // no-cache: a replaced image keeps its URL, so it has to be re-checked every time.
    @Get('load')
    @Header('Cache-Control', 'no-cache')
    loadImage(@Query('adventure') adventure: string, @Query('location') location: string): StreamableFile {
      const image = resolveMapImage(this.adventurePath(adventure), location)
      if (!image) {
        throw new NotFoundException(`No map image for location "${location}"`)
      }

      const response = new StreamableFile(createReadStream(image.path))
      response.options.type = contentTypeFor(image.fileName)
      return response
    }

    // The request body is the image itself (not multipart). Replaces the location's image and deletes the old file.
    @Post('upload')
    async uploadImage(
      @Query('adventure') adventure: string,
      @Query('location') location: string,
      @Req() request: IncomingMessage,
    ): Promise<{ file: string }> {
      const adventurePath = this.adventurePath(adventure)
      if (!isImageUploadType(request.headers['content-type'])) {
        throw new UnsupportedMediaTypeException('Send the image itself as the request body, with an image content type.')
      }
      const declared = Number(request.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        throw new PayloadTooLargeException('The image is larger than 25 MB.')
      }
      const bytes = await readBody(request, MAX_IMAGE_BYTES)
      return { file: saveMapImage(adventurePath, location, bytes) }
    }
}
