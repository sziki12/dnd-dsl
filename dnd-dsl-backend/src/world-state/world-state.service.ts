import { Injectable } from '@nestjs/common';
import { Model } from '@dnd-language/index.js';
import { parseModel, stringifyNode } from '@dnd-cli/main.js';
import { parseReferenceFromModel } from '@dnd-language/evaluation/dnd-dsl-reference.js';
import { LangiumInterpreterService } from '../langium-interpreter/langium-interpreter.service.js';
import { SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

export type FunctionSummary = {
  name: string;
  params: string[];
  description?: string;
};

export type EventSummary = {
  name: string;
  description?: string;
};

@Injectable()
export class WorldStateService {
  private _model: Model | undefined = undefined;
  private _worldState: any = {};
  //readonly pathCache = new SerializedPathCache();

  constructor(private readonly interpreterService: LangiumInterpreterService) {}

  async loadFromFile(filePath: string): Promise<any> {
    this._model = await parseModel(filePath);
    this._worldState = JSON.parse(stringifyNode(this._model));
    // this.pathCache.invalidateAll();
    return this._worldState;
  }

  getModel(): Model | undefined {
    return this._model;
  }

  getWorldState(): any {
    return this._worldState;
  }

  setWorldState(state: any): void {
    this._worldState = state;
    // Old WeakMap entries for the previous state objects will be GC'd automatically.
    // this.pathCache.invalidateAll();
  }

  /** Get a $ref for any node currently in the serialized state tree. */
  //toRef(node: object): SerializedRef | undefined {
  //  return this.pathCache.toRef(this._worldState, node);
  //}

  getFunctions(): FunctionSummary[] {
    if (!this._model) return [];
    return this._model.World.functions.map(f => ({
      name: f.name,
      params: f.params.map(p => p.name ?? p.target ?? ''),
      description: f.description,
    }));
  }

  getEvents(): EventSummary[] {
    if (!this._model) return [];
    return this._model.World.events.map(e => ({
      name: e.name,
      description: e.description,
    }));
  }

  async resolveReference(reference: SerializedRef): Promise<any> {
    if (!this._model) return undefined;
    if (!reference.$ref.startsWith('#')) reference.$ref = `#${reference.$ref}`;
    console.log(`Resolving reference: ${reference.$ref}`);
    const node = parseReferenceFromModel(this._model, reference);
    if (!node) return undefined;
    return stringifyNode(node);
  }
}
