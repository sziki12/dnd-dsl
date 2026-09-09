import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as vscode from 'vscode';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { createModelReference } from '@codingame/monaco-vscode-api/monaco';
import { getMonacoInit } from '../MonacoInit';
import { FileContext } from '../contexts/FileContext';

const SCRIPT_URI = 'file:///dnd-script.dnd';
const WORLD_URI = 'file:///dnd-script-world.dnd';

type WorldModelRef = Awaited<ReturnType<typeof createModelReference>>;

/**
 * A Monaco editor for the script console, wired to the `dnd-dsl` language server.
 * Opens the loaded world's source as a second (editor-less) model so the LSP can
 * resolve the script's `location "X"` / `trigger "E"` / `Enum::Value` references
 * against it (via DndScopeComputation). Recreated when the world switches.
 */
export function useScriptEditor(adventure: string, world: string, header: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<EditorApp | null>(null);
  const worldRef = useRef<WorldModelRef | null>(null);
  const headerRef = useRef(header);
  headerRef.current = header;
  const fileContext = useContext(FileContext);
  const [ready, setReady] = useState(false);

  const getValue = useCallback(
    () => appRef.current?.getTextModels().modified?.getValue() ?? '',
    [],
  );
  const setValue = useCallback((text: string) => {
    appRef.current?.getTextModels().modified?.setValue(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    (async () => {
      await getMonacoInit();
      if (cancelled || !containerRef.current) return;

      let worldSource = '';
      try {
        worldSource = (await fileContext.loadFile(adventure, world)).content;
      } catch {
        // no world source -> completion just won't include world entities
      }
      if (cancelled) return;

      worldRef.current = await createModelReference(vscode.Uri.parse(WORLD_URI), worldSource);
      if (cancelled) {
        worldRef.current.dispose();
        worldRef.current = null;
        return;
      }

      const app = new EditorApp({
        codeResources: {
          modified: { text: headerRef.current, uri: SCRIPT_URI, enforceLanguageId: 'dnd-dsl' },
        },
        languageDef: {
          languageExtensionConfig: { id: 'dnd-dsl', extensions: ['.dnd'], aliases: ['DnD DSL'] },
        },
        editorOptions: {
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          autoClosingQuotes: 'never',
          autoClosingBrackets: 'never',
          minimap: { enabled: false },
          fontFamily: 'Consolas, monospace',
          fontSize: 13,
          tabSize: 2,
          scrollBeyondLastLine: false,
        },
      });
      appRef.current = app;
      await app.start(containerRef.current);
      if (cancelled) {
        await app.dispose().catch(() => {});
        appRef.current = null;
        return;
      }
      setReady(true);
    })();

    return () => {
      cancelled = true;
      const app = appRef.current;
      const wr = worldRef.current;
      appRef.current = null;
      worldRef.current = null;
      void (async () => {
        await app?.dispose().catch(() => {});
        wr?.dispose();
      })();
    };
  }, [adventure, world, fileContext]);

  return { containerRef, getValue, setValue, ready };
}
