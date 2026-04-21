import { Test, TestingModule } from '@nestjs/testing';
import { LangiumParserService } from './langium-parser.service.js';
import { beforeEach, describe, it } from 'node:test';

describe('LangiumParserService', () => {
  let service: LangiumParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangiumParserService],
    }).compile();

    service = module.get<LangiumParserService>(LangiumParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
