import { Test, TestingModule } from '@nestjs/testing';
import { LangiumExportService } from './langium-export.service';

describe('LangiumExportService', () => {
  let service: LangiumExportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangiumExportService],
    }).compile();

    service = module.get<LangiumExportService>(LangiumExportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
