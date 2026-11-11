import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { BackendURL } from './BackendContext';
import type { Command, CommandResponse, ScriptEvent } from '@dnd-language/evaluation/dnd-dsl-commands';
import type { SerializedAstNode, SerializedModel, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types';
import { parseReferenceFromSerializedModel } from '@dnd-language/evaluation/dnd-dsl-reference';
import type { FiredReminder } from '@dnd-language/evaluation/dnd-dsl-reminders';
import { useStateSync } from '../common/useStateSync';

type DslContext = {
  world: string;
  updateWorld: (newWorld: string) => Promise<void>;
  adventure: string;
  updateAdventure: (newAdventure: string) => Promise<void>;
  /** The folder that holds the adventures: undefined until the server has been asked, null while none is chosen. */
  sourceFolder: string | null | undefined;
  /** Goes up each time any page writes or adds a world file; editors that show the files re-read them. */
  filesVersion: number;
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
  /** Why the last command, undo or redo was rejected, or null. The world state is left as it was. */
  commandError: string | null;
  clearCommandError: () => void;
  /** Whether THIS page currently holds control of the shared undo/redo history. 
   *  Other connected pages can still execute commands regardless of this. */
  isController: boolean;
  controllerName: string | null;
  claimControl: () => void;
};

export type ScriptRunResult = {
  ok: boolean;
  returnValue?: unknown;
  /** print and write effects, in the order they executed. */
  events?: ScriptEvent[];
  error?: string;
};

export const DslContext = createContext<DslContext>({} as DslContext);

/** The backend's rejection text: Nest's `message` is a string, or a list for validation errors. */
function describeCommandError(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return message === undefined ? `Request failed (${status})` : JSON.stringify(message);
}

export function DslContextNode({ children }: { children: React.ReactNode }) {
  // Which adventure and world are open is the server's to say (it holds one for every page); empty until it has.
  const [world, setWorld] = useState('');
  const [adventure, setAdventure] = useState('');
  // The "adventure/world" the server announced as already loaded, so this page does not parse it again.
  const announcedRef = useRef('');
  const [sourceFolder, setSourceFolder] = useState<string | null | undefined>(undefined);
  const [filesVersion, setFilesVersion] = useState(0);
  const [worldState, setWorldState] = useState<SerializedModel | undefined>(undefined);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [firedReminders, setFiredReminders] = useState<FiredReminder[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);
  const clearCommandError = useCallback(() => setCommandError(null), []);

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
    // A server with nothing loaded answers with an empty state.
    setWorldState(responseJson?.World ? responseJson : undefined);
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

  const fetchActiveWorld = async (): Promise<{ adventure?: string; world?: string; loaded: boolean; sourceFolder: string | null }> =>
    (await fetch(`${BackendURL}/adventure/active`)).json();

  // The reminders on screen belong to the world that was open.
  const adoptWorld = (nextAdventure: string, nextWorld: string) => {
    announcedRef.current = `${nextAdventure}/${nextWorld}`;
    setAdventure(nextAdventure);
    setWorld(nextWorld);
    setFiredReminders([]);
    setCommandError(null);
  };

  // A new source folder leaves no world open: the pages wait for one to be chosen from it.
  const adoptSourceFolder = (folder: string | null) => {
    announcedRef.current = '';
    setSourceFolder(folder);
    setAdventure('');
    setWorld('');
    setWorldState(undefined);
    setCanUndo(false);
    setCanRedo(false);
    setFiredReminders([]);
    setCommandError(null);
  };

  // After a dropped connection: follow the folder and the world the server has now. A server that lost its world
  // (it could not reopen it) is given this page's world instead.
  const catchUp = async () => {
    const active = await fetchActiveWorld().catch(() => undefined);
    if (!active) return;
    const folderChanged = active.sourceFolder !== (sourceFolder ?? null);
    if (folderChanged) adoptSourceFolder(active.sourceFolder);
    if (!active.sourceFolder) return;

    if (active.loaded && active.adventure && active.world) {
      if (active.adventure !== adventure || active.world !== world) adoptWorld(active.adventure, active.world);
      await updateWorldState();
    } else if (adventure && world && !folderChanged) {
      await reloadWorld();
    } else if (active.adventure && active.world) {
      setAdventure(active.adventure);
      setWorld(active.world);
    }
  };

  // Live sync across every open page/tab/device: applyCommandResponse handles a broadcast from another page exactly like
  // one from this page's own request; catchUp handles anything missed while this page was disconnected.
  const { isController, controllerName, claimControl, clientId } = useStateSync(applyCommandResponse, catchUp, adoptWorld, adoptSourceFolder, () => setFilesVersion(version => version + 1));

  // A rejected command (HTTP 400) carries `{ message }` instead of a CommandResponse. Applying it would
  // replace the world state with undefined and blank every page, so it is shown as an error instead
  // and the last good state stays.
  const sendCommand = async (path: string, init: RequestInit): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`${BackendURL}/command/${path}`, { method: 'POST', ...init });
    } catch {
      setCommandError('Could not reach the server.');
      return;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setCommandError(describeCommandError(body, response.status));
      return;
    }
    setCommandError(null);
    applyCommandResponse(body);
  };

  const execute = (cmd: Command): Promise<void> => sendCommand('execute', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });

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
      events: body.events,
    };
  };

  const undo = (): Promise<void> => sendCommand('undo', { headers: { 'X-Client-Id': clientId } });

  const redo = (): Promise<void> => sendCommand('redo', { headers: { 'X-Client-Id': clientId } });

  const updateWorld = async (newWorld: string) => setWorld(newWorld);
  const updateAdventure = async (newAdventure: string) => setAdventure(newAdventure);

  const getByReference = <T extends SerializedAstNode>(ref: SerializedRef | undefined): T | undefined => {
    if (!worldState || !ref) return undefined;
    
    return parseReferenceFromSerializedModel<T>(worldState, ref);
  };

  // Ctrl+Z / Ctrl+Y - bubble phase so Monaco (capture phase) handles its own undo first.
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
    fetchActiveWorld()
      .then(active => {
        setSourceFolder(active.sourceFolder ?? null);
        if (!active.adventure || !active.world) return;
        setAdventure(active.adventure);
        setWorld(active.world);
      })
      .catch(() => console.warn('Could not ask the server which world is open'));
  }, []);

  useEffect(() => {
    if (!world || !adventure || announcedRef.current === `${adventure}/${world}`) return;
    reloadWorld();
  }, [world, adventure]);

  return (
    <DslContext.Provider value={{
      world, updateWorld,
      adventure, updateAdventure,
      sourceFolder, filesVersion,
      worldState, updateWorldState, reloadWorld,
      getByReference,
      execute, runScript, undo, redo, canUndo, canRedo,
      firedReminders, clearFiredReminder,
      commandError, clearCommandError,
      isController, controllerName, claimControl,
    }}>
      {children}
    </DslContext.Provider>
  );
}
