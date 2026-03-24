import { Test, TestingModule } from '@nestjs/testing';
import { LocationParsingService } from './location-parsing.service.js';

describe('LocationParsingService', () => {
  let service: LocationParsingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocationParsingService],
    }).compile();

    service = module.get<LocationParsingService>(LocationParsingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
