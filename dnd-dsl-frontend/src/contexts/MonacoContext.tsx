import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { createModelReference } from '@codingame/monaco-vscode-api/monaco';
import * as vscode from 'vscode';
import { getMonacoInit, VIEW_FILE_EXTENSION } from '../MonacoInit';
import { FileContext } from './FileContext';
import { DslContext } from './DslContext';
import { enclosingQuestAt, type EntityRef } from '../common/entity-at-cursor';
import { planRefresh } from '../common/world-file-refresh';

/** What the editor needs from the page to offer "Open View" on a named object in the world. */
export type EntityActions = {
    /** The entity at a 1-based column of a line of text, if there is one. `enclosingQuest` is the quest the line is in. */
    find: (line: string, column: number, enclosingQuest?: string) => EntityRef | undefined,
    open: (entity: EntityRef) => void,
}

/** One of the files the open world is written in. */
export type EditorFile = { name: string, dirty: boolean }

type MonacoContext = {
    startEditor: (element: HTMLDivElement, entityActions?: EntityActions) => Promise<void>,
    /** True when any file of the world has edits that were neither loaded from nor saved to disk. */
    hasUnsavedChanges: () => boolean,
    disposeEditor: () => Promise<void>,
    /** Writes every changed file, then reparses the world once. */
    saveFile: () => Promise<{ ok: boolean; errors?: string[] }>,
    /** Swaps the editor to a read-only, highlighted model holding `text` (the world with its state merged in). */
    showMergedView: (text: string) => Promise<void>,
    /** Swaps the editor back to the editable source. */
    showSourceView: () => void,
    /** The world's files, in name order, while an editor is open. */
    files: EditorFile[],
    selectedFile: string | undefined,
    selectFile: (name: string) => void,
    /** Adds a file to the world and opens it. */
    createFile: (name: string) => Promise<{ ok: boolean; error?: string }>,
}

type ViewMode = 'source' | 'merged';
type ScrollPosition = { top: number; left: number };
type ModelRef = Awaited<ReturnType<typeof createModelReference>>;
/** A file of the world as an editor model; `saved` is the model version that is on disk. */
type OpenFile = { ref: ModelRef; saved: number; listener: { dispose(): void } };

const MERGED_URI = `file:///dnd-world-with-state${VIEW_FILE_EXTENSION}`;
const NO_SCROLL: ScrollPosition = { top: 0, left: 0 };

export const MonacoContext = createContext<MonacoContext>({} as MonacoContext);

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    const editorAppRef = useRef<EditorApp | null>(null);
    const fileContext = useContext(FileContext);
    const dlsContext = useContext(DslContext);
    // The editor page keeps the functions below from the render it mounted in, long after the open world may have
    // changed, so they read the current names and loaders through this instead of their own render's.
    const latest = useRef({ fileContext, dlsContext });
    latest.current = { fileContext, dlsContext };

    // Scroll lives outside the editor so it survives the editor being disposed on navigation.
    const scrollRef = useRef<{ merged: ScrollPosition; files: Record<string, ScrollPosition> }>({ merged: NO_SCROLL, files: {} });
    const viewModeRef = useRef<ViewMode>('source');
    const viewModelRef = useRef<ModelRef | null>(null);
    // A merged view requested before the editor exists is applied once it has started.
    const pendingMergedRef = useRef<string | null>(null);
    const viewRequestRef = useRef(0);

    // Every file of the world is a model, so the language server knows all of them and names link across files;
    // the editor shows the selected one.
    const openFilesRef = useRef<Map<string, OpenFile>>(new Map());
    const selectedRef = useRef<string | undefined>(undefined);
    const loadRequestRef = useRef(0);
    const [files, setFiles] = useState<EditorFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | undefined>(undefined);

    // The editor itself starts on an empty placeholder; the world's files are shown in it by setModel.
    const getEditorConfig = () =>
    {
        const editorAppConfig: EditorAppConfig = {
            codeResources: {
                modified: {
                    text: '',
                    uri: "file:///dnd-editor-placeholder.dnd",
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

    const modelOf = (name: string | undefined) =>
        name === undefined ? null : openFilesRef.current.get(name)?.ref.object.textEditorModel ?? null;

    const isDirty = (open: OpenFile) => {
        const model = open.ref.object.textEditorModel;
        return !!model && model.getAlternativeVersionId() !== open.saved;
    };

    const hasUnsavedChanges = () => [...openFilesRef.current.values()].some(isDirty);

    const publishFiles = () => {
        const next = [...openFilesRef.current.entries()]
            .map(([name, open]) => ({ name, dirty: isDirty(open) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        setFiles(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };

    const fileUri = (name: string) => {
        const { adventure, world } = latest.current.dlsContext;
        return vscode.Uri.from({ scheme: 'file', path: `/${adventure}/${world}/${name}` });
    };

    const openFile = async (name: string, text: string) => {
        const ref = await createModelReference(fileUri(name), text);
        const model = ref.object.textEditorModel;
        openFilesRef.current.set(name, {
            ref,
            saved: model?.getAlternativeVersionId() ?? 0,
            listener: model ? model.onDidChangeContent(publishFiles) : { dispose() { /* no model, nothing to stop */ } },
        });
    };

    const closeFiles = () => {
        for (const open of openFilesRef.current.values()) {
            open.listener.dispose();
            open.ref.dispose();
        }
        openFilesRef.current.clear();
    };

    // The right-click item is shown only when the cursor is on the name of something the world declares.
    const registerEntityAction = (editor: NonNullable<ReturnType<EditorApp['getEditor']>>, actions: EntityActions) => {
        const entityAtCursor = () => {
            const position = editor.getPosition();
            const model = editor.getModel();
            if (!position || !model) return undefined;
            const quest = enclosingQuestAt(lineNumber => model.getLineContent(lineNumber), position.lineNumber);
            return actions.find(model.getLineContent(position.lineNumber), position.column, quest);
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

    const saveScroll = () => {
        const editor = editorAppRef.current?.getEditor();
        if (!editor) return;
        const position = { top: editor.getScrollTop(), left: editor.getScrollLeft() };
        if (viewModeRef.current === 'merged') scrollRef.current.merged = position;
        else if (selectedRef.current !== undefined) scrollRef.current.files[selectedRef.current] = position;
    };

    const restoreScroll = (mode: ViewMode) => {
        const { top, left } = mode === 'merged'
            ? scrollRef.current.merged
            : (selectedRef.current !== undefined && scrollRef.current.files[selectedRef.current]) || NO_SCROLL;
        editorAppRef.current?.getEditor()?.setScrollPosition({ scrollTop: top, scrollLeft: left });
    };

    /** Puts the selected file in the editor. */
    const showSelected = () => {
        const editor = editorAppRef.current?.getEditor();
        const model = modelOf(selectedRef.current);
        if (!editor || !model) return;
        editor.setModel(model);
        editor.updateOptions({ readOnly: false });
        restoreScroll('source');
    };

    /** Reads the world's files from disk into models, dropping edits that were not saved. */
    const loadWorldFiles = async (): Promise<void> => {
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        const { adventure, world } = dsl;
        const app = editorAppRef.current;
        if (!app || !adventure || !world) return;
        const request = ++loadRequestRef.current;

        let loaded: { name: string; text: string }[];
        try {
            const list = await loader.listFiles(adventure, world);
            loaded = await Promise.all(list.files.map(async name => ({ name, text: (await loader.loadFile(adventure, world, name)).content })));
        } catch (e) {
            console.error('Could not load the files of the world', e);
            return;
        }
        if (request !== loadRequestRef.current || editorAppRef.current !== app) return;

        // The models are about to go: park the editor on the placeholder first.
        const placeholder = app.getTextModels().modified;
        if (placeholder) app.getEditor()?.setModel(placeholder);
        closeFiles();
        for (const { name, text } of loaded) await openFile(name, text);
        if (request !== loadRequestRef.current || editorAppRef.current !== app) return;

        const names = [...openFilesRef.current.keys()].sort((a, b) => a.localeCompare(b));
        const keep = selectedRef.current !== undefined && openFilesRef.current.has(selectedRef.current) ? selectedRef.current : names[0];
        selectedRef.current = keep;
        setSelectedFile(keep);
        publishFiles();
        if (viewModeRef.current === 'source') showSelected();
    };

    /** Another page wrote or added a file: take it up, keeping every file with unsaved edits here as it is. */
    const refreshWorldFiles = async (): Promise<void> => {
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        const { adventure, world } = dsl;
        const app = editorAppRef.current;
        if (!app || !adventure || !world) return;
        const request = loadRequestRef.current;

        let disk: { name: string; text: string }[];
        try {
            const list = await loader.listFiles(adventure, world);
            disk = await Promise.all(list.files.map(async name => ({ name, text: (await loader.loadFile(adventure, world, name)).content })));
        } catch (e) {
            console.error('Could not re-read the files of the world', e);
            return;
        }
        // A full reload (another world, or the editor closing) is newer than this one.
        if (request !== loadRequestRef.current || editorAppRef.current !== app) return;

        const open = [...openFilesRef.current.entries()].map(([name, file]) => ({
            name, dirty: isDirty(file), text: file.ref.object.textEditorModel?.getValue() ?? '',
        }));
        const { add, update } = planRefresh(open, disk);
        for (const { name, text } of update) {
            const file = openFilesRef.current.get(name);
            file?.ref.object.textEditorModel?.setValue(text);
            if (file) file.saved = file.ref.object.textEditorModel?.getAlternativeVersionId() ?? file.saved;
        }
        for (const { name, text } of add) {
            if (!openFilesRef.current.has(name)) await openFile(name, text);
        }
        publishFiles();
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
        closeFiles();
        const app = new EditorApp(getEditorConfig());

        editorAppRef.current = app;
        await app.start(element);
        const editor = app.getEditor();
        if (editor && entityActions) registerEntityAction(editor, entityActions);
        viewModeRef.current = 'source';
        await loadWorldFiles();
        if (pendingMergedRef.current !== null) await showMergedView(pendingMergedRef.current);

        console.log('Editor started');
    };

    const selectFile = (name: string) => {
        if (!openFilesRef.current.has(name) || name === selectedRef.current) return;
        if (viewModeRef.current === 'source') saveScroll();
        selectedRef.current = name;
        setSelectedFile(name);
        if (viewModeRef.current === 'source') showSelected();
    };

    const createFile = async (name: string): Promise<{ ok: boolean; error?: string }> => {
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        try {
            const created = await loader.newFile(dsl.adventure, dsl.world, name);
            const { content } = await loader.loadFile(dsl.adventure, dsl.world, created);
            await openFile(created, content);
            publishFiles();
            selectFile(created);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
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
        if (!editor || !modelOf(selectedRef.current) || viewModeRef.current === 'source') return;

        saveScroll();
        viewModeRef.current = 'source';
        showSelected();
    };

    const disposeEditor = async () => {
        loadRequestRef.current++;
        if (editorAppRef.current) {
            saveScroll();
            await editorAppRef.current.dispose();
            editorAppRef.current = null; // ← clear ref so next startEditor creates fresh
            console.log('Editor disposed');
        }
        closeFiles();
        setFiles([]);
        viewRequestRef.current++;
        viewModelRef.current?.dispose();
        viewModelRef.current = null;
        viewModeRef.current = 'source';
    };

    const saveFile = async (): Promise<{ ok: boolean; errors?: string[] }> => {
        if (viewModeRef.current === 'merged') {
            return { ok: false, errors: ['Switch back to the source view to save.'] };
        }
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        const { adventure, world } = dsl;

        // The file models, never the editor's current one: that may be the read-only merged view.
        try {
            for (const [name, open] of openFilesRef.current) {
                const model = open.ref.object.textEditorModel;
                if (!model || !isDirty(open)) continue;
                await loader.saveFile({ identifier: { adventure, world }, file: name, content: model.getValue() });
                open.saved = model.getAlternativeVersionId();
            }
        } catch (e) {
            publishFiles();
            return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
        }
        publishFiles();
        return await dsl.reloadWorld();
    };

    // Another page (or this one) wrote or added a file.
    useEffect(() => {
        if (editorAppRef.current) void refreshWorldFiles();
    }, [dlsContext.filesVersion]);

    // Another adventure or world was opened (by any page): the editor shows its files.
    useEffect(() => {
        if (!dlsContext.adventure || !dlsContext.world || !editorAppRef.current) return;
        void loadWorldFiles();
    }, [dlsContext.adventure, dlsContext.world]);

    return (
        <MonacoContext.Provider value={{
            startEditor, hasUnsavedChanges, disposeEditor, saveFile, showMergedView, showSourceView,
            files, selectedFile, selectFile, createFile,
        }}>
            {children}
        </MonacoContext.Provider>
    );
}
