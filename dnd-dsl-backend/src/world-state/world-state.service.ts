import { Injectable } from '@nestjs/common';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import {
  type CodeBlock,
  createDndDslServices,
  isChangeOccurrence,
  isOnBlock,
  isVariableDeclaration,
  Model,
  OnBlock,
} from '@dnd-language/index.js';
import { AstUtils } from 'langium';
import { parseModel, parseWorld, stringifyNode } from '@dnd-cli/main.js';
import { registerBuiltinDocument } from '@dnd-language/builtin-documents.js';
import {
  decodeStatePath,
  encodeStatePath,
  resolveVariableContainer,
  statePathToNode,
  type StatePath,
} from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import { canonicalOverlayEntries, canonicalReminder } from '@dnd-language/evaluation/dnd-dsl-state-migration.js';
import { evaluateSerializedExpression } from '@dnd-language/evaluation/dnd-dsl-value-evaluator.js';
import { applyOverlayToServed, spliceOverlayValue as spliceOverlayInto } from '@dnd-language/evaluation/dnd-dsl-overlay.js';
import { foreignWorldNames, type ForeignWorlds } from '@dnd-language/evaluation/dnd-dsl-foreign.js';
import type { FiredReminder, ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';
import { LangiumInterpreterService } from '../langium-interpreter/langium-interpreter.service.js';
import { predefinedFunctions, predefinedFunctionsAsMap } from '../predefined/predefined-functions.js';
import { type StateOverlayFile } from './state-overlay.types.js';
import * as fs from 'fs';
import { renderSourceWithState, StateSourceView } from '@dnd-language/evaluation/dnd-dsl-state-source.js';

export type FunctionSummary = {
  name: string;
  params: string[];
  description?: string;
};

export type PredefinedFunctionSummary = {
  name: string;
  params: string[];
  description?: string;
  /** A statement-position call also stores its result into its first argument. */
  writesBack?: boolean;
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

export type HandlerIndex = {
  changeHandlers: Map<string, OnBlock[]>;
  triggerHandlers: Map<string, OnBlock[]>;
};

@Injectable()
export class WorldStateService {
  //Source text of the loaded world
  private _worldSource = '';

  // The parsed AST of the loaded world, without overlay
  private _model: Model | undefined = undefined;
  
  // The current world state, with overlay applied
  private _worldState: any = {};

  // Only values that differ from the source
  private _overlay: Record<string, unknown> = {};
  private _staleOverlayEntries: StatePath[] = [];
  
  private _statePath: string | undefined = undefined;

  // The other worlds of the adventure this world reads, and how to read more of them.
  private _foreign = new Map<string, ReturnType<ForeignWorlds['read']>>();
  private _foreignSource: ((worlds: string[]) => Promise<ForeignWorlds>) | undefined = undefined;

  
  
  private _clock: number = 0;
  private _reminders: ScheduledReminder[] = [];
  private _firedReminders: FiredReminder[] = [];
  private _changeHandlers: Map<string, OnBlock[]> = new Map();
  private _triggerHandlers: Map<string, OnBlock[]> = new Map();

  constructor(private readonly interpreterService: LangiumInterpreterService) {}

  /** One file, whatever world it declares. */
  async loadFromFile(dndFilePath: string, statePath?: string): Promise<any> {
    const model = await parseModel(dndFilePath);
    return this.install(model, fs.readFileSync(dndFilePath, 'utf-8'), statePath);
  }

  /**
   * The world `worldName` from its files: one, or the equal parts of a folder, each saying `world "<worldName>"`.
   * `prepareForeign` gives the state of other worlds of the adventure that it reads or leads into; without it, it
   * cannot read them.
   */
  async loadFromFiles(
    files: string[],
    worldName: string,
    statePath?: string,
    prepareForeign?: (worlds: string[]) => Promise<ForeignWorlds>,
  ): Promise<any> {
    const { model, source, foreign } = await parseWorld(files, worldName, prepareForeign);
    const state = this.install(model, source, statePath);
    this._foreignSource = prepareForeign;
    this._foreign = new Map(foreign ? foreignWorldNames(model, worldName).map(name => [name, foreign.read(name)] as const) : []);
    return state;
  }

  /** The other worlds this world can read, as they were when it loaded. */
  getForeignWorlds(): ForeignWorlds {
    return { read: world => this._foreign.get(world) ?? { problem: `"${world}" is not another world of this adventure that was read when this world loaded.` } };
  }

  /** Makes more worlds readable: a script may mention one the world itself does not. */
  async prepareForeign(worlds: string[]): Promise<void> {
    const missing = worlds.filter(name => !this._foreign.has(name));
    if (missing.length === 0 || !this._foreignSource) return;
    const prepared = await this._foreignSource(missing);
    for (const name of missing) this._foreign.set(name, prepared.read(name));
  }

  /** The source of the loaded world: its files glued together when it has several. */
  getWorldSource(): string {
    return this._worldSource;
  }

  private install(model: Model, source: string, statePath: string | undefined): any {
    this._model = model;
    this._worldSource = source;
    this._statePath = statePath;
    this._foreign = new Map();
    this._foreignSource = undefined;
    const overlayFile = statePath && fs.existsSync(statePath)
      ? (JSON.parse(fs.readFileSync(statePath, 'utf-8')) as StateOverlayFile)
      : undefined;
    this.applyOverlayFile(overlayFile);
    this.buildHandlerIndex();
    return this._worldState;
  }

  /** Forgets the loaded world, so nothing more is written to its files. */
  unload(): void {
    this._model = undefined;
    this._worldSource = '';
    this._statePath = undefined;
    this._overlay = {};
    this._clock = 0;
    this._reminders = [];
    this._firedReminders = [];
    this._changeHandlers = new Map();
    this._triggerHandlers = new Map();
    this._foreign = new Map();
    this._foreignSource = undefined;
    this.rebuildWorldState();
  }

  /** Replaces the whole runtime state (overrides, clock, reminders) with a saved one and rebuilds the served world. */
  applyOverlayFile(overlayFile: StateOverlayFile | undefined): void {
    // State saved before sublocations were addressed through their parents carries the old, name-only form.
    this._overlay = canonicalOverlayEntries(this._model!, overlayFile?.entries ?? {});
    this._clock = overlayFile?.clock ?? 0;
    this._reminders = (overlayFile?.reminders ?? []).map(reminder => canonicalReminder(this._model!, reminder));
    this._firedReminders = (overlayFile?.firedReminders ?? []).map(reminder => canonicalReminder(this._model!, reminder));
    this.rebuildWorldState();
  }

  /** The runtime state in the shape of the `.state.json` file. */
  snapshotOverlayFile(): StateOverlayFile {
    return {
      version: 1,
      entries: this._overlay,
      clock: this._clock,
      reminders: this._reminders,
      firedReminders: this._firedReminders,
    };
  }

  /**
   * Parses a script and links it against the loaded world. 
   * The script is its own document headed by `reference world "<name>"`. 
   * Diagnostics are returned, not thrown, with line numbers relative to the source text.
   * If a script doesnt have a headed it is likely called from an event.
   */
  async parseScript(source: string): Promise<{ codeBlock?: CodeBlock; errors: ScriptParseError[] }> {
    if (!this._model || !this._worldSource) {
      return { errors: [{ message: 'No world is loaded.', line: 0 }] };
    }
    const worldName = this._model.World.name;
    const hasHeader = /^\s*reference\s+world\b/.test(source);
    const scriptSource = hasHeader ? source : `reference world "${worldName}"\n${source}`;
    const addedLines = hasHeader ? 0 : 1;

    const { shared } = createDndDslServices(NodeFileSystem);
    const ws = shared.workspace;
    const worldUri = URI.parse('memory://script/world.dnd');
    const scriptUri = URI.parse('memory://script/run.dnd');
    const worldDoc = ws.LangiumDocumentFactory.fromString(this._worldSource, worldUri);
    const scriptDoc = ws.LangiumDocumentFactory.fromString(scriptSource, scriptUri);
    ws.LangiumDocuments.addDocument(worldDoc);
    ws.LangiumDocuments.addDocument(scriptDoc);
    // Load pre declared objects
    await registerBuiltinDocument(shared);
    await ws.DocumentBuilder.build([worldDoc, scriptDoc], { validation: true });

    const errors: ScriptParseError[] = [];
    for (const e of scriptDoc.parseResult.parserErrors) {
      const line = (e.token?.startLine ?? 1) - 1;
      errors.push({ message: e.message, line: Math.max(0, line - addedLines) });
    }
    for (const d of scriptDoc.diagnostics ?? []) {
      if (d.severity !== 1) continue;
      errors.push({ message: d.message, line: Math.max(0, d.range.start.line - addedLines) });
    }

    const scriptWorld = (scriptDoc.parseResult.value as Model).World;
    if (scriptWorld && !scriptWorld.isReference) {
      errors.push({ message: 'A script must start with `reference world "<name>"`.', line: 0 });
    } else if (scriptWorld?.isReference && scriptWorld.name !== worldName) {
      errors.push({ message: `Script targets world "${scriptWorld.name}" but "${worldName}" is loaded.`, line: 0 });
    }

    await ws.LangiumDocuments.deleteDocument(worldUri);
    await ws.LangiumDocuments.deleteDocument(scriptUri);

    return { codeBlock: errors.length ? undefined : scriptWorld?.script, errors };
  }

  getRenderedWorld(): StateSourceView {
    if (!this._model) return { text: '', changes: [], stale: [] };
    const state = this.getWorldState();
    return renderSourceWithState(this._model, this._worldSource, this._overlay, path => this.computedValueAt(state, path));
  }

  /** The current value of a computed variable, read off the served state; undefined when it cannot be evaluated. */
  private computedValueAt(state: any, path: StatePath): unknown {
    try {
      const node = statePathToNode(state, path);
      return evaluateSerializedExpression(state, isVariableDeclaration(node) ? node.value : node);
    } catch {
      return undefined;
    }
  }

  /** 
   * Writes the current overlay to the `.state.json` file it was loaded with. 
   * Called by CommandService after every mutating command. 
   */
  persistOverlay(): void {
    if (!this._statePath) return;
    fs.writeFileSync(this._statePath, JSON.stringify(this.snapshotOverlayFile(), null, 2), 'utf-8');
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

  /** Appends reminders that fired outside a clock tick (a `remind` with no `after`). */
  addFiredReminders(fired: FiredReminder[]): void {
    this._firedReminders.push(...fired);
  }

  /** 
   *  Advances the clock and moves every now-due reminder into `_firedReminders`
   *  (effectRan starts false - CommandService flips it after running the effect, since only it has interpreter access).
   *  Returns the newly-fired ones.
   **/
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

  getHandlerIndex(): HandlerIndex {
    return { changeHandlers: this._changeHandlers, triggerHandlers: this._triggerHandlers };
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

  /** 
   *  Writes one overlay entry and immediately re-splices `_worldState` so
   *  `getWorldState()` reflects it without a full reload. 
   *  This is meant to be the only way `_worldState`'s variable values change post-load.
   **/
  setOverlayEntry(path: StatePath, value: unknown): void {
    this._overlay[encodeStatePath(path)] = value;
    this.spliceOverlayValue(path, value);
  }

  /** 
   *  Replaces the whole overlay (undo/redo) and rebuilds `_worldState` from scratch against it
   **/
  restoreOverlay(overlay: Record<string, unknown>): void {
    this._overlay = overlay;
    this.rebuildWorldState();
  }

  /** 
   *  Drops all overlay entries and clock/reminder state, reverting `_worldState` to the declared defaults of the `.dnd` file. 
   **/
  resetOverlay(): void {
    this._overlay = {};
    this._clock = 0;
    this._reminders = [];
    this._firedReminders = [];
    this.rebuildWorldState();
  }

  /** 
   *  Indexes every OnBlock in the model by its resolved target, so a write or event
   *  trigger can look up matching handlers in O(1) instead of walking the AST per write.
   *  Rebuilt only on reparse.
   **/
  private buildHandlerIndex(): void {
    this._changeHandlers = new Map();
    this._triggerHandlers = new Map();
    if (!this._model) return;

    for (const node of AstUtils.streamAllContents(this._model)) {
      if (!isOnBlock(node)) continue;
      const occ = node.occurrence;

      if (isChangeOccurrence(occ)) {
        let path;
        try {
          path = this.interpreterService.resolveStaticRefChainToStatePath(occ.target);
        } catch {
          continue;
        }
        const key = encodeStatePath(path);
        const list = this._changeHandlers.get(key) ?? [];
        list.push(node);
        this._changeHandlers.set(key, list);
      } else {
        const eventName = occ.target.val.ref?.name;
        if (!eventName) continue;
        const list = this._triggerHandlers.get(eventName) ?? [];
        list.push(node);
        this._triggerHandlers.set(eventName, list);
      }
    }
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
    return applyOverlayToServed(this._worldState, this._overlay);
  }

  private spliceOverlayValue(path: StatePath, value: unknown): boolean {
    return spliceOverlayInto(this._worldState, path, value);
  }
}
