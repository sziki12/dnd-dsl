import { Test, TestingModule } from '@nestjs/testing';
import { ExpressionParsingService } from './expression-parsing.service';

describe('ExpressionParsingService', () => {
  let service: ExpressionParsingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpressionParsingService],
    }).compile();

    service = module.get<ExpressionParsingService>(ExpressionParsingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
