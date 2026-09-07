import { createContext, useEffect, useState } from 'react';
import { BackendURL } from './BackendContext';
import type { Command, CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands';
import type { SerializedAstNode, SerializedModel, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types';
import { parseReferenceFromSerializedModel } from '@dnd-language/evaluation/dnd-dsl-reference';
import type { FiredReminder } from '@dnd-language/evaluation/dnd-dsl-reminders';

type DslContext = {
  world: string;
  updateWorld: (newWorld: string) => Promise<void>;
  adventure: string;
  updateAdventure: (newAdventure: string) => Promise<void>;
  worldState: SerializedModel | undefined;
  updateWorldState: () => Promise<void>;
  getByReference<T extends SerializedAstNode>(ref: SerializedRef | undefined): T | undefined;
  execute: (cmd: Command) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  firedReminders: FiredReminder[];
  clearFiredReminder: (id: string) => void;
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

  const parseWorldState = async () => {
    const endpoint = `${stateEndpoint}/parse?adventure=${adventure}&world=${world}`;
    console.log(`endpoint: ${endpoint}`);
    await fetch(endpoint, { method: 'POST' });
    console.log('World File Parsed');
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

  const execute = async (cmd: Command): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    applyCommandResponse(await response.json());
  };

  const undo = async (): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/undo`, { method: 'POST' });
    applyCommandResponse(await response.json());
  };

  const redo = async (): Promise<void> => {
    const response = await fetch(`${BackendURL}/command/redo`, { method: 'POST' });
    applyCommandResponse(await response.json());
  };

  const updateWorld = async (newWorld: string) => setWorld(newWorld);
  const updateAdventure = async (newAdventure: string) => setAdventure(newAdventure);

  const getByReference = <T extends SerializedAstNode>(ref: SerializedRef | undefined): T | undefined => {
    if (!worldState || !ref) return undefined;
    
    return parseReferenceFromSerializedModel<T>(worldState, ref);
  };

  // Ctrl+Z / Ctrl+Y — bubble phase so Monaco (capture phase) handles its own undo first
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canUndo, canRedo]);

  useEffect(() => {
    if (!world || !adventure) return;
    parseWorldState().then(updateWorldState);
  }, [world, adventure]);

  return (
    <DslContext.Provider value={{
      world, updateWorld,
      adventure, updateAdventure,
      worldState, updateWorldState,
      getByReference,
      execute, undo, redo, canUndo, canRedo,
      firedReminders, clearFiredReminder,
    }}>
      {children}
    </DslContext.Provider>
  );
}
