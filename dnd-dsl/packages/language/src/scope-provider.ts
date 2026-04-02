import { AstNode, DefaultScopeProvider, MapScope, ReferenceInfo, Scope, stream } from "langium";
import { isCodeBlock, isVariableDeclaration, isVariableRef, VariableDeclaration } from "./generated/ast.js";

export class DndScopeProvider extends DefaultScopeProvider 
{
    override getScope(context: ReferenceInfo): Scope 
    {
        if (isVariableRef(context.container)) 
        {
            return this.getVariableScope(context.container, context);
        }
        
        return super.getScope(context);
    }

    private getVariableScope(node: AstNode, context: ReferenceInfo): Scope 
    {
        const declarations: VariableDeclaration[] = [];
        let current: AstNode | undefined = context.container.$container;
        
        while (current) 
        {
            if (isCodeBlock(current)) 
            {
                //Previous declarations are visible only
                for (const code of current.code) 
                {
                    if (isVariableDeclaration(code)) 
                    {
                        declarations.push(code);
                    }
                    //Current statement
                    if (code === context.container) break;
                }
            }
            current = current.$container;
        }
        const globalScope = super.getScope(context);

        if (declarations.length === 0) return globalScope;
        
        return new MapScope(
            stream(declarations).map(d => this.descriptions.createDescription(d, d.target)),
            globalScope  // fallback
        );
    }
}