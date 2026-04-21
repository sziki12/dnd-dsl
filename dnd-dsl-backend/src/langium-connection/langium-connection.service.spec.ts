import { Test, TestingModule } from '@nestjs/testing';
import { LangiumConnectionGateway } from './langium-connection.service.js';

describe('LangiumConnectionGateway', () => {
  let service: LangiumConnectionGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangiumConnectionGateway],
    }).compile();

    service = module.get<LangiumConnectionGateway>(LangiumConnectionGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
