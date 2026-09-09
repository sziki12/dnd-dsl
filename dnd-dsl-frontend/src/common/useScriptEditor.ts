import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as vscode from 'vscode';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { createModelReference } from '@codingame/monaco-vscode-api/monaco';
import { getMonacoInit } from '../MonacoInit';
import { FileContext } from '../contexts/FileContext';

const SCRIPT_URI = 'file:///dnd-script.dnd';
const WORLD_URI = 'file:///dnd-script-world.dnd';

type WorldModelRef = Awaited<ReturnType<typeof createModelReference>>;
type Disposable = { dispose(): void };

type SuggestModelLike = {
  onDidTrigger(cb: () => void): Disposable;
  onDidSuggest(cb: (e: { completionModel?: { items?: unknown[] } }) => void): Disposable;
  onDidCancel(cb: () => void): Disposable;
};
type SuggestControllerLike = {
  model?: SuggestModelLike;
  _model?: SuggestModelLike;
  triggerSuggest?: () => void;
};

/**
 * A manual Ctrl+Space (or a trigger character) that returns no items leaves Monaco's
 * suggest model in a non-idle state with a null completion model; typing then routes
 * to a refilter that no-ops on the null model, so the "No suggestions" widget stays
 * stuck until a non-keyboard cancel. When the last completed request came back empty,
 * re-trigger on the next edit so typing into that dead state recovers.
 */
function wireSuggestRecovery(app: EditorApp): Disposable[] {
  const editor = app.getEditor();
  const suggest = editor?.getContribution('editor.contrib.suggestController') as unknown as
    | SuggestControllerLike
    | null;
  const model = suggest?.model ?? suggest?._model;
  if (!editor || !suggest?.triggerSuggest || !model) return [];

  // Only the *settled* empty state is stuck; an in-flight request must not re-trigger
  // itself, so clear the flag whenever a new request starts or the session cancels.
  let lastRequestEmpty = false;
  return [
    model.onDidTrigger(() => { lastRequestEmpty = false; }),
    model.onDidCancel(() => { lastRequestEmpty = false; }),
    model.onDidSuggest((e) => { lastRequestEmpty = (e.completionModel?.items?.length ?? 0) === 0; }),
    editor.onDidChangeModelContent(() => {
      if (lastRequestEmpty) suggest.triggerSuggest!();
    }),
  ];
}

/**
 * A Monaco editor for the script console, wired to the `dnd-dsl` language server.
 * Opens the loaded world's source as a second (editor-less) model so the LSP can
 * resolve the script's `location "X"` / `trigger "E"` / `Enum::Value` references
 * against it (via DndScopeComputation). Recreated when the world switches.
 *
 * `initialText` seeds the editor on (re)mount - pass the persisted script so it
 * survives navigation. `onChange` fires on every edit with the full text.
 */
export function useScriptEditor(
  adventure: string,
  world: string,
  initialText: string,
  onChange?: (text: string) => void,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<EditorApp | null>(null);
  const worldRef = useRef<WorldModelRef | null>(null);
  const suggestFixRef = useRef<Disposable[]>([]);
  const initialTextRef = useRef(initialText);
  initialTextRef.current = initialText;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
          modified: { text: initialTextRef.current, uri: SCRIPT_URI, enforceLanguageId: 'dnd-dsl' },
        },
        languageDef: {
          languageExtensionConfig: { id: 'dnd-dsl', extensions: ['.dnd'], aliases: ['DnD DSL'] },
        },
        editorOptions: {
          quickSuggestions: false,
          suggestOnTriggerCharacters: true,
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
      // Must be registered before start() - the editor wires it during creation.
      app.registerOnTextChangedCallback((tc) => onChangeRef.current?.(tc.modified ?? ''));
      await app.start(containerRef.current);
      if (cancelled) {
        await app.dispose().catch(() => {});
        appRef.current = null;
        return;
      }
      // The world header may have resolved during the async gap above; if the model
      // was seeded empty and there is text to show now, apply it.
      const model = app.getTextModels().modified;
      if (model && model.getValue() === '' && initialTextRef.current) {
        model.setValue(initialTextRef.current);
      }
      suggestFixRef.current = wireSuggestRecovery(app);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      const app = appRef.current;
      const wr = worldRef.current;
      const fixes = suggestFixRef.current;
      appRef.current = null;
      worldRef.current = null;
      suggestFixRef.current = [];
      fixes.forEach((d) => d.dispose());
      void (async () => {
        await app?.dispose().catch(() => {});
        wr?.dispose();
      })();
    };
  }, [adventure, world, fileContext]);

  return { containerRef, getValue, setValue, ready };
}
