import type * as ast from '../generated/ast.js';
import type { Reference, AstNode } from 'langium';

/** A Langium cross-reference after JSON serialization: { "$ref": "#/World/locations@0" } */
export type SerializedRef = { $ref: string; $refText?: string };

// Langium node fields that are not emitted by JsonSerializer
type LangiumInternals = '$container' | '$document' | '$cstNode' | '$range' | '$path';

type SerializeValue<V> =
    V extends Reference<any>         ? SerializedRef :
    V extends AstNode                ? SerializedNode<V> :
    V extends Array<Reference<any>>  ? SerializedRef[] :
    V extends Array<infer El>        ? (El extends AstNode ? SerializedNode<El>[] : El[]) :
    V;

export type SerializedNode<T extends AstNode> = {
    [K in keyof Omit<T, LangiumInternals>]: SerializeValue<T[K]>
};

export type SerializedModel          = SerializedNode<ast.Model>;
export type SerializedWorld          = SerializedNode<ast.World>;
export type SerializedLocation       = SerializedNode<ast.Location>;
export type SerializedLocationEntry  = SerializedNode<ast.LocationEntry>;
export type SerializedLocationExit   = SerializedNode<ast.LocationExit>;
//export type SerializedLocationChain  = SerializedNode<ast.LocationChain>;
export type SerializedQuest          = SerializedNode<ast.Quest>;
export type SerializedObjective      = SerializedNode<ast.Objective>;
export type SerializedEvent          = SerializedNode<ast.Event>;
export type SerializedNpc            = SerializedNode<ast.Npc>;
export type SerializedFaction        = SerializedNode<ast.Faction>;
export type SerializedState           = SerializedNode<ast.State>;
export type SerializedStateValueDecl  = SerializedNode<ast.StateValueDecl>;
export type SerializedStateValueRef   = SerializedNode<ast.StateValueRef>;
export type SerializedFunctionDecl   = SerializedNode<ast.FunctionDeclaration>;
export type SerializedVariableDecl   = SerializedNode<ast.VariableDeclaration>;
export type SerializedExpression     = SerializedNode<ast.Expression>;
export type SerializedListLiteral    = SerializedNode<ast.ListLiteral>;
export type SerializedCodeBlock      = SerializedNode<ast.CodeBlock>;
export type SerializedRefChain          = SerializedNode<ast.RefChain>;
export type SerializedVariableRefItem   = SerializedNode<ast.VariableRefItem>;
export type SerializedLocationRefItem   = SerializedNode<ast.LocationRefItem>;

export type SerializedAstNode       = SerializedNode<AstNode>;