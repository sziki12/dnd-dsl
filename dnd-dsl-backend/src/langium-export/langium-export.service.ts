import { Injectable } from '@nestjs/common';
import { AstNode } from 'langium';

/**
 * Service for exporting the AST back to a DSL file.
 * Currently not implemented, but could be used for saving the world state back in the language.
 */
@Injectable()
export class LangiumExportService {

  exportToText(ast: AstNode): string {
    return ""//generateDslFile(model);
  }
}
