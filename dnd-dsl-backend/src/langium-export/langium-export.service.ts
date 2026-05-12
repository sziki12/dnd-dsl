import { Injectable } from '@nestjs/common';
import { AstNode } from 'langium';

@Injectable()
export class LangiumExportService {

  exportToText(ast: AstNode): string {
    return ""//generateDslFile(model);
  }
}
