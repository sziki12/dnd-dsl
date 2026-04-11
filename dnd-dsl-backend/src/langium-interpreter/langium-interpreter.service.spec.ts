import { Test, TestingModule } from '@nestjs/testing';
import { LangiumInterpreterService } from './langium-interpreter.service.js';

describe('LangiumInterpreterService', () => {
  let service: LangiumInterpreterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangiumInterpreterService],
    }).compile();

    service = module.get<LangiumInterpreterService>(LangiumInterpreterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
