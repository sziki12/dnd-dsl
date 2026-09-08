import { Injectable } from '@nestjs/common';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { type CodeBlock, createDndDslServices, isVariableDeclaration, Model } from '@dnd-language/index.js';
import { parseModel, stringifyNode } from '@dnd-cli/main.js';
import {
  decodeStatePath,
  encodeStatePath,
  resolveVariableContainer,
  statePathToNode,
  type StatePath,
} from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import type { FiredReminder, ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';
import { LangiumInterpreterService } from '../langium-interpreter/langium-interpreter.service.js';
import { predefinedFunctions, predefinedFunctionsAsMap } from '../predefined/predefined-functions.js';
import { type StateOverlayFile } from './state-overlay.types.js';
import * as fs from 'fs';

export type FunctionSummary = {
  name: string;
  params: string[];
  description?: string;
};

export type PredefinedFunctionSummary = {
  name: string;
  params: string[];
  description?: string;
  code: (...args: any[]) => any;
};

export type EventSummary = {
  name: string;
  description?: string;
};

export type DeclaredFunctionsResponse = {
  functions: FunctionSummary[];
  predefinedFunctions: PredefinedFunctionSummary[];
};

/** One parse/link problem in a script, with a line number relative to the DM's text. */
export type ScriptParseError = { message: string; line: number };

@Injectable()
export class WorldStateService {
  private _model: Model | undefined = undefined;
  private _worldSource = '';
  private _worldState: any = {};
  private _overlay: Record<string, unknown> = {};
  private _staleOverlayEntries: StatePath[] = [];
  private _statePath: string | undefined = undefined;
  private _clock: number = 0;
  private _reminders: ScheduledReminder[] = [];
  private _firedReminders: FiredReminder[] = [];

  constructor(private readonly interpreterService: LangiumInterpreterService) {}

  async loadFromFile(dndFilePath: string, statePath?: string): Promise<any> {
    this._model = await parseModel(dndFilePath);
    this._worldSource = fs.readFileSync(dndFilePath, 'utf-8');
    this._statePath = statePath;
    const overlayFile = statePath && fs.existsSync(statePath)
      ? (JSON.parse(fs.readFileSync(statePath, 'utf-8')) as StateOverlayFile)
      : undefined;
    this._overlay = overlayFile?.entries ?? {};
    this._clock = overlayFile?.clock ?? 0;
    this._reminders = overlayFile?.reminders ?? [];
    this._firedReminders = overlayFile?.firedReminders ?? [];
    this.rebuildWorldState();
    return this._worldState;
  }

  /**
   * Parses a DM script and links it against the loaded world. The script is its own
   * document headed by `reference world "<name>"` (prepended here if the caller sent
   * only bare statements); it is built alongside a fresh copy of the world document
   * so its `location "X"` / `trigger "E"` / `call fn` / `Enum::Value` references
   * resolve (see DndScopeComputation). Diagnostics are returned, not thrown, with
   * line numbers relative to the DM's own text.
   */
  async parseScript(source: string): Promise<{ codeBlock?: CodeBlock; errors: ScriptParseError[] }> {
    if (!this._model || !this._worldSource) {
      return { errors: [{ message: 'No world is loaded.', line: 0 }] };
    }
    const worldName = this._model.World.name;
    const hasHeader = /^\s*reference\s+world\b/.test(source);
    const scriptSource = hasHeader ? source : `reference world "${worldName}"\n${source}`;
    const prependedLines = hasHeader ? 0 : 1;

    const { shared } = createDndDslServices(NodeFileSystem);
    const ws = shared.workspace;
    const worldUri = URI.parse('memory://script/world.dnd');
    const scriptUri = URI.parse('memory://script/run.dnd');
    const worldDoc = ws.LangiumDocumentFactory.fromString(this._worldSource, worldUri);
    const scriptDoc = ws.LangiumDocumentFactory.fromString(scriptSource, scriptUri);
    ws.LangiumDocuments.addDocument(worldDoc);
    ws.LangiumDocuments.addDocument(scriptDoc);
    await ws.DocumentBuilder.build([worldDoc, scriptDoc], { validation: true });

    const errors: ScriptParseError[] = [];
    for (const e of scriptDoc.parseResult.parserErrors) {
      const line = ((e as { token?: { startLine?: number } }).token?.startLine ?? 1) - 1;
      errors.push({ message: e.message, line: Math.max(0, line - prependedLines) });
    }
    for (const d of scriptDoc.diagnostics ?? []) {
      if (d.severity !== 1) continue;
      errors.push({ message: d.message, line: Math.max(0, d.range.start.line - prependedLines) });
    }

    const sw = (scriptDoc.parseResult.value as Model).World;
    if (sw && !sw.isReference) {
      errors.push({ message: 'A script must start with `reference world "<name>"`.', line: 0 });
    } else if (sw?.isReference && sw.name !== worldName) {
      errors.push({ message: `Script targets world "${sw.name}" but "${worldName}" is loaded.`, line: 0 });
    }

    await ws.LangiumDocuments.deleteDocument(worldUri);
    await ws.LangiumDocuments.deleteDocument(scriptUri);

    return { codeBlock: errors.length ? undefined : sw?.script, errors };
  }

  /** Writes the current overlay to the `.state.json` sidecar it was loaded with (a
   *  no-op if it wasn't loaded from a file path, e.g. in a unit test). Called by
   *  CommandService after every mutating command. */
  persistOverlay(): void {
    if (!this._statePath) return;
    const overlayFile: StateOverlayFile = {
      version: 1,
      entries: this._overlay,
      clock: this._clock,
      reminders: this._reminders,
      firedReminders: this._firedReminders,
    };
    fs.writeFileSync(this._statePath, JSON.stringify(overlayFile, null, 2), 'utf-8');
  }

  getClock(): number {
    return this._clock;
  }

  getReminders(): ScheduledReminder[] {
    return this._reminders;
  }

  getFiredReminders(): FiredReminder[] {
    return this._firedReminders;
  }

  setClock(clock: number): void {
    this._clock = clock;
  }

  setReminders(reminders: ScheduledReminder[]): void {
    this._reminders = reminders;
  }

  setFiredReminders(firedReminders: FiredReminder[]): void {
    this._firedReminders = firedReminders;
  }

  /** Advances the clock and moves every now-due reminder into firedReminders
   *  (effectRan starts false - CommandService flips it after running the effect,
   *  since only it has interpreter access). Returns just the newly-fired ones. */
  advanceClock(deltaRounds: number): FiredReminder[] {
    this._clock += deltaRounds;
    const due = this._reminders.filter(r => r.fireAtRound <= this._clock);
    this._reminders = this._reminders.filter(r => r.fireAtRound > this._clock);
    const justFired: FiredReminder[] = due.map(r => ({
      id: r.id,
      label: r.label,
      severity: r.severity,
      createdAtRound: r.createdAtRound,
      pin: r.pin,
      bodyLocator: r.bodyLocator,
      firedAtRound: this._clock,
      effectRan: false,
    }));
    this._firedReminders.push(...justFired);
    return justFired;
  }

  /** Removes one entry from firedReminders. Returns whether it was found. */
  ackReminder(id: string): boolean {
    const index = this._firedReminders.findIndex(r => r.id === id);
    if (index < 0) return false;
    this._firedReminders.splice(index, 1);
    return true;
  }

  getModel(): Model | undefined {
    return this._model;
  }

  getWorldState(): any {
    this._worldState.clock = this._clock;
    return this._worldState;
  }

  setWorldState(state: any): void {
    this._worldState = state;
  }

  getFunctions(): DeclaredFunctionsResponse {
    if (!this._model) return { functions: [], predefinedFunctions: [] };
    return {
      functions : this._model.World.functions.map(f => ({
        name: f.name,
        params: f.params.map(p => p.name ?? p.target ?? ''),
        description: f.description,
      })),
      predefinedFunctions: predefinedFunctions
    }
  }

  getEvents(): EventSummary[] {
    if (!this._model) return [];
    return this._model.World.events.map(e => ({
      name: e.name,
      description: e.description,
    }));
  }

  getOverlay(): Record<string, unknown> {
    return this._overlay;
  }

  getStaleOverlayEntries(): StatePath[] {
    return this._staleOverlayEntries;
  }

  /** Writes one overlay entry and immediately re-splices `_worldState` so
   *  `getWorldState()` reflects it without a full reload. This is meant to be the
   *  only way `_worldState`'s variable values change post-load — see CommandService. */
  setOverlayEntry(path: StatePath, value: unknown): void {
    this._overlay[encodeStatePath(path)] = value;
    this.spliceOverlayValue(path, value);
  }

  /** Replaces the whole overlay (undo/redo) and rebuilds `_worldState` from scratch
   *  against it, so no stray in-place mutation from before the swap can linger. */
  restoreOverlay(overlay: Record<string, unknown>): void {
    this._overlay = overlay;
    this.rebuildWorldState();
  }

  /** Drops all overlay entries and clock/reminder state, reverting `_worldState` to the
   *  `.dnd`-declared defaults. */
  resetOverlay(): void {
    this._overlay = {};
    this._clock = 0;
    this._reminders = [];
    this._firedReminders = [];
    this.rebuildWorldState();
  }

  private rebuildWorldState(): void {
    if (!this._model) {
      this._worldState = {};
      this._staleOverlayEntries = [];
      return;
    }
    this._worldState = JSON.parse(stringifyNode(this._model));
    this._worldState.predefinedFunctions = predefinedFunctionsAsMap;
    this._staleOverlayEntries = this.applyOverlay();
  }

  private applyOverlay(): StatePath[] {
    const stale: StatePath[] = [];
    for (const [encodedPath, value] of Object.entries(this._overlay)) {
      const path = decodeStatePath(encodedPath);
      if (!this.spliceOverlayValue(path, value)) stale.push(path);
    }
    return stale;
  }

  /** Resolves `path` against the serialized `_worldState` (structurally generic — walks
   *  plain JSON the same way it walks real AST nodes) and, if it points at a non-computed
   *  variable, writes `value` into it. If the leaf doesn't exist yet but its parent
   *  container does (a real Location/Quest/etc, or an already-declared `object` block),
   *  creates it — this is what lets ASSIGN_VARIABLE create a variable that wasn't
   *  declared in the `.dnd` source, and it runs on every rebuild (load/undo/redo), so a
   *  created variable persists the same way a real one does. Returns false without
   *  writing anything if neither the leaf nor its parent resolve (renamed/removed
   *  location, became computed, etc). */
  private spliceOverlayValue(path: StatePath, value: unknown): boolean {
    const node = statePathToNode(this._worldState, path);
    if (node) {
      if (!isVariableDeclaration(node) || node.isComputed === 'computed') return false;
      (node as any).value = value;
      return true;
    }

    const containerInfo = resolveVariableContainer(this._worldState, path);
    if (!containerInfo) return false;
    containerInfo.variables.push({ $type: 'VariableDeclaration', target: containerInfo.target, value } as any);
    return true;
  }
}
