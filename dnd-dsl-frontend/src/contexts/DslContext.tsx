import { createContext, useEffect, useState } from 'react';
import { BackendURL } from './BackendContext';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands';
import type { SerializedAstNode, SerializedModel, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types';
import { parseReferenceFromSerializedModel } from '@dnd-language/evaluation/dnd-dsl-reference';
import type { FiredReminder } from '@dnd-language/evaluation/dnd-dsl-reminders';
import { useStateSync } from '../common/useStateSync';

type DslContext = {
  world: string;
  updateWorld: (newWorld: string) => Promise<void>;
  adventure: string;
  updateAdventure: (newAdventure: string) => Promise<void>;
  worldState: SerializedModel | undefined;
  updateWorldState: () => Promise<void>;
  reloadWorld: () => Promise<{ ok: boolean; errors?: string[] }>;
  getByReference<T extends SerializedAstNode>(ref: SerializedRef | undefined): T | undefined;
  execute: (cmd: Command) => Promise<void>;
  runScript: (source: string) => Promise<ScriptRunResult>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  firedReminders: FiredReminder[];
  clearFiredReminder: (id: string) => void;
  /** Whether THIS page currently holds control of the shared undo/redo history. 
   *  Other connected pages can still execute commands regardless of this. */
  isController: boolean;
  controllerName: string | null;
  claimControl: () => void;
};

export type ScriptRunResult = {
  ok: boolean;
  returnValue?: unknown;
  printedValue?: unknown[];
  writes?: { path: string; value: unknown }[];
  error?: string;
};

export const DslContext = createContext<DslContext>({} as DslContext);

export function DslContextNode({ children }: { children: React.ReactNode }) {
  const [world, setWorld] = useState('World');
  const [adventure, setAdventure] = useState('Adventure');
  const [worldState, setWorldState] = useState<SerializedModel | undefined>(undefined);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [firedReminders, setFiredReminders] = useState<FiredReminder[]>([]);

  const stateEndpoint = `${BackendURL}`;

  const parseWorldState = async (): Promise<{ ok: boolean; errors?: string[] }> => {
    const endpoint = `${stateEndpoint}/parse?adventure=${adventure}&world=${world}`;
    console.log(`endpoint: ${endpoint}`);
    const response = await fetch(endpoint, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const errors = Array.isArray(body?.errors) ? (body.errors as string[]) : ['Parse failed'];
      console.warn('World reparse failed', errors);
      return { ok: false, errors };
    }
    console.log('World File Parsed');
    return { ok: true };
  };

  // Re-read the world file into the backend and refresh the served state. Used after
  // an edit in the /editor page so changes to the .dnd source become live. A parse
  // failure leaves the last good state in place and returns the errors.
  const reloadWorld = async (): Promise<{ ok: boolean; errors?: string[] }> => {
    const result = await parseWorldState();
    if (result.ok) await updateWorldState();
    return result;
  };

  const updateWorldState = async () => {
    const endpoint = `${stateEndpoint}/world`;
    console.log(`endpoint: ${endpoint}`);
    const response = await fetch(endpoint, { method: 'GET' });
    console.log(`Status: ${response.status}`);
    const responseJson = await response.json();
    console.log('World State loaded');
    setWorldState(responseJson);
  };

  const applyCommandResponse = (res: CommandResponse) => {
    setWorldState(res.worldState);
    setCanUndo(res.canUndo);
    setCanRedo(res.canRedo);
    if (res.firedReminders?.length) {
      setFiredReminders(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        return [...prev, ...res.firedReminders!.filter(r => !existingIds.has(r.id))];
      });
    }
  };

  const clearFiredReminder = (id: string) => {
    setFiredReminders(prev => prev.filter(r => r.id !== id));
  };

  // Live sync across every open page/tab/device: applyCommandResponse handles a broadcast from another page exactly like
  // one from this page's own request; reloadWorld catches up on anything missed while this page was disconnected.
  const { isController, controllerName, claimControl, clientId } = useStateSync(applyCommandResponse, reloadWorld);

  const execute = async (cmd: Command): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    applyCommandResponse(await response.json());
  };

  const runScript = async (source: string): Promise<ScriptRunResult> => {
    const response = await fetch(`${BackendURL}/command/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'RUN_SCRIPT', source }),
    });
    const body = await response.json();
    if (!response.ok) {
      const msg = body?.message;
      return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg ?? body) };
    }
    applyCommandResponse(body);
    return {
      ok: true,
      returnValue: body.scriptResult?.returnValue,
      printedValue: body.scriptResult?.printedValue,
      writes: body.scriptResult?.writes,
    };
  };

  const undo = async (): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/undo`, { method: 'POST', headers: { 'X-Client-Id': clientId } });
    applyCommandResponse(await response.json());
  };

  const redo = async (): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/redo`, { method: 'POST', headers: { 'X-Client-Id': clientId } });
    applyCommandResponse(await response.json());
  };

  const updateWorld = async (newWorld: string) => setWorld(newWorld);
  const updateAdventure = async (newAdventure: string) => setAdventure(newAdventure);

  const getByReference = <T extends SerializedAstNode>(ref: SerializedRef | undefined): T | undefined => {
    if (!worldState || !ref) return undefined;
    
    return parseReferenceFromSerializedModel<T>(worldState, ref);
  };

  // Ctrl+Z / Ctrl+Y — bubble phase so Monaco (capture phase) handles its own undo first.
  // A no-op while another page holds control.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !isController) return;
      if (e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canUndo, canRedo, isController]);

  useEffect(() => {
    if (!world || !adventure) return;
    reloadWorld();
  }, [world, adventure]);

  return (
    <DslContext.Provider value={{
      world, updateWorld,
      adventure, updateAdventure,
      worldState, updateWorldState, reloadWorld,
      getByReference,
      execute, runScript, undo, redo, canUndo, canRedo,
      firedReminders, clearFiredReminder,
      isController, controllerName, claimControl,
    }}>
      {children}
    </DslContext.Provider>
  );
}
