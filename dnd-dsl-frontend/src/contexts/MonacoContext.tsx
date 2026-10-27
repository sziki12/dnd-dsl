import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { createModelReference } from '@codingame/monaco-vscode-api/monaco';
import * as vscode from 'vscode';
import { FILE_URI, getMonacoInit, toMonacoUri, VIEW_FILE_EXTENSION } from '../MonacoInit';
import { FileContext } from './FileContext';
import { DslContext } from './DslContext';
import type { EntityRef } from '../common/entity-at-cursor';

/** What the editor needs from the page to offer "Open View" on a named object in the world. */
export type EntityActions = {
    /** The entity at a 1-based column of a line of text, if there is one. */
    find: (line: string, column: number) => EntityRef | undefined,
    open: (entity: EntityRef) => void,
}

type MonacoContext = {
    startEditor: (element: HTMLDivElement, entityActions?: EntityActions) => Promise<void>,
    /** True when the source model has edits that were neither loaded from nor saved to the file. */
    hasUnsavedChanges: () => boolean,
    disposeEditor: () => Promise<void>,
    saveFile: () => Promise<{ ok: boolean; errors?: string[] }>,
    /** Swaps the editor to a read-only, highlighted model holding `text` (the world with its state merged in). */
    showMergedView: (text: string) => Promise<void>,
    /** Swaps the editor back to the editable source. */
    showSourceView: () => void,
}

type ViewMode = 'source' | 'merged';
type ScrollPosition = { top: number; left: number };
type ViewModelRef = Awaited<ReturnType<typeof createModelReference>>;

const MERGED_URI = `file:///dnd-world-with-state${VIEW_FILE_EXTENSION}`;

export const MonacoContext = createContext<MonacoContext>({} as MonacoContext);

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    const editorAppRef = useRef<EditorApp | null>(null);
    const fileContext = useContext(FileContext);
    const dlsContext = useContext(DslContext);

    // Scroll lives outside the editor so it survives the editor being disposed on navigation.
    const scrollRef = useRef<Record<ViewMode, ScrollPosition>>({
        source: { top: 0, left: 0 },
        merged: { top: 0, left: 0 },
    });
    const viewModeRef = useRef<ViewMode>('source');
    const viewModelRef = useRef<ViewModelRef | null>(null);
    // A merged view requested before the editor exists is applied once it has started.
    const pendingMergedRef = useRef<string | null>(null);
    const viewRequestRef = useRef(0);

    const getEditorConfig = (content: string) =>
    {
        const editorAppConfig: EditorAppConfig = {
            codeResources: {
                /*original: {
                    text: '// initial editor content',
                    uri: FILE_URI_STRING,
                    enforceLanguageId: 'dnd-dsl',
                },*/
                modified: {
                    text: content,
                    uri: "file:///modified_file.dnd",
                    enforceLanguageId: 'dnd-dsl',
                },
            },
            // Register the language with Monaco so enforceLanguageId is recognized
            languageDef: {
                languageExtensionConfig: {
                    id: 'dnd-dsl',
                    extensions: ['.dnd'],
                    aliases: ['DnD DSL', 'dnd-dsl'],
                    mimetypes: ['text/x-dnd-dsl']
                }
                // No monarchLanguage needed yet — LSP will provide semantic tokens
                // Add a monarchLanguage here later for basic syntax highlighting
                // without LSP, or use a TextMate grammar via vscodeApiConfig.extensions
            }
        }
        return editorAppConfig
    }

    let editorAppConfig = getEditorConfig("//Initial content")

    const savedVersionRef = useRef<number | undefined>(undefined);

    const markSaved = () => {
        savedVersionRef.current = editorAppRef.current?.getTextModels().modified?.getAlternativeVersionId();
    };

    const hasUnsavedChanges = () => {
        const model = editorAppRef.current?.getTextModels().modified;
        return !!model && savedVersionRef.current !== undefined && model.getAlternativeVersionId() !== savedVersionRef.current;
    };

    // The right-click item is shown only when the cursor is on the name of something the world declares.
    const registerEntityAction = (editor: NonNullable<ReturnType<EditorApp['getEditor']>>, actions: EntityActions) => {
        const entityAtCursor = () => {
            const position = editor.getPosition();
            const model = editor.getModel();
            return position && model ? actions.find(model.getLineContent(position.lineNumber), position.column) : undefined;
        };
        const onEntity = editor.createContextKey<boolean>('dndEntityUnderCursor', false);
        const refresh = () => onEntity.set(entityAtCursor() !== undefined);
        editor.onDidChangeCursorPosition(refresh);
        editor.onDidChangeModel(refresh);

        editor.addAction({
            id: 'dnd.openEntityView',
            label: 'Open View',
            precondition: 'dndEntityUnderCursor',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1,
            run: () => {
                const entity = entityAtCursor();
                if (entity) actions.open(entity);
            },
        });
    };

    const startEditor = async (element: HTMLDivElement, entityActions?: EntityActions) => {
        await getMonacoInit()
        .then(() => console.log('MonacoContext: init complete'))
        .catch((e: any) => console.error('MonacoContext: init failed', e));

        // If a disposed or stale instance exists, always create a fresh one
        if (editorAppRef.current) {
            await editorAppRef.current.dispose().catch(() => {});
            editorAppRef.current = null;
        }
        const app = new EditorApp(editorAppConfig);

        editorAppRef.current = app;
        await app.start(element);
        const editor = app.getEditor();
        if (editor && entityActions) registerEntityAction(editor, entityActions);
        markSaved();
        viewModeRef.current = 'source';
        restoreScroll('source');
        if (pendingMergedRef.current !== null) await showMergedView(pendingMergedRef.current);

        console.log('URI:', app?.getEditor()?.getModel()?.uri.toString(), 'Language:', app?.getEditor()?.getModel()?.getLanguageId());
        console.log('Editor started');
    };

    const saveScroll = () => {
        const editor = editorAppRef.current?.getEditor();
        if (!editor) return;
        scrollRef.current[viewModeRef.current] = { top: editor.getScrollTop(), left: editor.getScrollLeft() };
    };

    const restoreScroll = (mode: ViewMode) => {
        const { top, left } = scrollRef.current[mode];
        editorAppRef.current?.getEditor()?.setScrollPosition({ scrollTop: top, scrollLeft: left });
    };

    const showMergedView = async (text: string) => {
        pendingMergedRef.current = text;
        const editor = editorAppRef.current?.getEditor();
        if (!editor) return;

        const request = ++viewRequestRef.current;
        let viewRef = viewModelRef.current;
        if (!viewRef) {
            const created = await createModelReference(vscode.Uri.parse(MERGED_URI), text);
            if (request !== viewRequestRef.current || editorAppRef.current?.getEditor() !== editor) {
                created.dispose();
                return;
            }
            viewRef = viewModelRef.current = created;
        }
        const model = viewRef.object.textEditorModel;
        if (!model) return;

        if (model.getValue() !== text) {
            model.applyEdits([{ range: model.getFullModelRange(), text }]);
        }
        if (viewModeRef.current === 'merged') return;

        saveScroll();
        viewModeRef.current = 'merged';
        editor.setModel(model);
        editor.updateOptions({
            readOnly: true,
            readOnlyMessage: { value: 'This is the world with its current state merged in. Switch back to the source to edit.' },
        });
        restoreScroll('merged');
    };

    const showSourceView = () => {
        pendingMergedRef.current = null;
        viewRequestRef.current++;
        const editor = editorAppRef.current?.getEditor();
        const source = editorAppRef.current?.getTextModels().modified;
        if (!editor || !source || viewModeRef.current === 'source') return;

        saveScroll();
        viewModeRef.current = 'source';
        editor.setModel(source);
        editor.updateOptions({ readOnly: false });
        restoreScroll('source');
    };

    const disposeEditor = async () => {
        if (editorAppRef.current) {
            saveScroll();
            await editorAppRef.current.dispose();
            editorAppRef.current = null; // ← clear ref so next startEditor creates fresh
            console.log('Editor disposed');
        }
        viewRequestRef.current++;
        viewModelRef.current?.dispose();
        viewModelRef.current = null;
        viewModeRef.current = 'source';
    };

    const saveFile = async (): Promise<{ ok: boolean; errors?: string[] }> => {
        if (viewModeRef.current === 'merged') {
            return { ok: false, errors: ['Switch back to the source view to save.'] };
        }
        // The source model, never the editor's current one: that may be the read-only merged view.
        const content = editorAppRef.current?.getTextModels().modified?.getValue();
        if (!content) return { ok: false, errors: ['Nothing to save.'] };

        await fileContext?.saveFile({identifier: {adventure: dlsContext.adventure, world:dlsContext.world}, content: content})
        markSaved();
        return await dlsContext.reloadWorld();
    };

    useEffect(()=>{
        if(!fileContext.loaded)
            return

        fileContext.loadFile(dlsContext.adventure, dlsContext.world).then(file => {
            // The text the file holds is the saved baseline, whenever updateCode finishes applying it.
            Promise.resolve(editorAppRef.current?.updateCode({modified:file.content})).then(markSaved)
            if (viewModeRef.current === 'source') restoreScroll('source')
            editorAppConfig = getEditorConfig(file.content)
        });
    },[fileContext.loaded])

    return (
        <MonacoContext.Provider value={{ startEditor, hasUnsavedChanges, disposeEditor, saveFile, showMergedView, showSourceView }}>
            {children}
        </MonacoContext.Provider>
    );
}
