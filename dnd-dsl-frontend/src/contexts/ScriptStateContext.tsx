import { createContext, useMemo, useRef } from 'react';
import type { ScriptRunResult } from './DslContext';

export type ScriptHistoryItem = { source: string; result: ScriptRunResult };

type ScriptState = {
  /** The world file the persisted state belongs to; a mismatch discards it. */
  world: string;
  /** Editor text. Falsy means "seed from the world header instead". */
  source: string | null;
  history: ScriptHistoryItem[];
  result: ScriptRunResult | null;
};

type ScriptStateContextValue = {
  readState: () => ScriptState;
  writeState: (patch: Partial<ScriptState>) => void;
};

const EMPTY: ScriptState = { world: '', source: null, history: [], result: null };

/**
 * Holds the `/script` page state so it survives navigating away and back (the Monaco
 * editor and ScriptView both unmount on a route change). Backed by a ref, not state -
 * writes here never re-render, they are only read on the next mount.
 */
export const ScriptStateContext = createContext<ScriptStateContextValue>({
  readState: () => EMPTY,
  writeState: () => {},
});

export function ScriptStateContextNode({ children }: { children: React.ReactNode }) {
  const ref = useRef<ScriptState>({ world: '', source: null, history: [], result: null });

  const value = useMemo<ScriptStateContextValue>(
    () => ({
      readState: () => ref.current,
      writeState: (patch) => {
        ref.current = { ...ref.current, ...patch };
      },
    }),
    [],
  );

  return <ScriptStateContext.Provider value={value}>{children}</ScriptStateContext.Provider>;
}
