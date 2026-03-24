import { Module } from '@nestjs/common';
import { LocationParsingService } from './location-parsing/location-parsing.service.js';
import { ExpressionParsingService } from './expression-parsing/expression-parsing.service.js';

@Module({
  providers: [LocationParsingService, ExpressionParsingService],
  exports: [LocationParsingService]
})
export class ParsingModule {}
