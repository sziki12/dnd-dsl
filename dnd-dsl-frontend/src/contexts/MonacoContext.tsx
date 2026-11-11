import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { createModelReference } from '@codingame/monaco-vscode-api/monaco';
import * as vscode from 'vscode';
import { getMonacoInit, VIEW_FILE_EXTENSION } from '../MonacoInit';
import { FileContext } from './FileContext';
import { DslContext } from './DslContext';
import { enclosingQuestAt, type EntityRef } from '../common/entity-at-cursor';
import { planRefresh } from '../common/world-file-refresh';
import { fileKey, firstFile, splitKey, type FileRef } from '../common/adventure-tree';

/** What the editor needs from the page to offer "Open View" on a named object in the world. */
export type EntityActions = {
    /** The entity at a 1-based column of a line of text, if there is one. `enclosingQuest` is the quest the line is in. */
    find: (line: string, column: number, enclosingQuest?: string) => EntityRef | undefined,
    open: (entity: EntityRef) => void,
}

/** One file of one world of the adventure. */
export type EditorFile = FileRef & { dirty: boolean }
/** A world of the adventure; `problem` says why its files could not be listed. */
export type EditorWorld = { world: string, problem?: string }

type MonacoContext = {
    startEditor: (element: HTMLDivElement, entityActions?: EntityActions) => Promise<void>,
    /** True when any file of any world has edits that were neither loaded from nor saved to disk. */
    hasUnsavedChanges: () => boolean,
    disposeEditor: () => Promise<void>,
    /** Writes every changed file, then reparses the open world once. */
    saveFile: () => Promise<{ ok: boolean; errors?: string[] }>,
    /** Swaps the editor to a read-only, highlighted model holding `text` (the open world with its state merged in). */
    showMergedView: (text: string) => Promise<void>,
    /** Swaps the editor back to the editable source. */
    showSourceView: () => void,
    /** The worlds of the open adventure and their files, while an editor is open. */
    worlds: EditorWorld[],
    files: EditorFile[],
    selected: FileRef | undefined,
    /** True while the editor shows the read-only merged view, so no single file can be picked. */
    merged: boolean,
    selectFile: (world: string, name: string) => void,
    /** Shows a file with a line of it in view. */
    revealAt: (world: string, name: string, line: number) => void,
    /** Adds a file to a world and opens it. */
    createFile: (world: string, name: string) => Promise<{ ok: boolean; error?: string }>,
}

type ViewMode = 'source' | 'merged';
type ScrollPosition = { top: number; left: number };
type ModelRef = Awaited<ReturnType<typeof createModelReference>>;
/** A file as an editor model; `saved` is the model version that is on disk. */
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

    // Every file of every world of the adventure is a model, keyed by `fileKey(world, name)`, so the language server
    // knows all of them (a name means its own world's there); the editor shows the selected one.
    const openFilesRef = useRef<Map<string, OpenFile>>(new Map());
    const selectedRef = useRef<string | undefined>(undefined);
    const loadRequestRef = useRef(0);
    const [worlds, setWorlds] = useState<EditorWorld[]>([]);
    const [files, setFiles] = useState<EditorFile[]>([]);
    const [selected, setSelected] = useState<FileRef | undefined>(undefined);
    const [merged, setMerged] = useState(false);

    // The editor itself starts on an empty placeholder; the files are shown in it by setModel.
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

    const modelOf = (key: string | undefined) =>
        key === undefined ? null : openFilesRef.current.get(key)?.ref.object.textEditorModel ?? null;

    const isDirty = (open: OpenFile) => {
        const model = open.ref.object.textEditorModel;
        return !!model && model.getAlternativeVersionId() !== open.saved;
    };

    const hasUnsavedChanges = () => [...openFilesRef.current.values()].some(isDirty);

    const publishFiles = () => {
        const next = [...openFilesRef.current.entries()]
            .map(([key, open]) => ({ ...splitKey(key), dirty: isDirty(open) }))
            .sort((a, b) => a.world.localeCompare(b.world) || a.name.localeCompare(b.name));
        setFiles(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };

    const fileUri = (world: string, name: string) =>
        vscode.Uri.from({ scheme: 'file', path: `/${latest.current.dlsContext.adventure}/${world}/${name}` });

    const openFile = async (world: string, name: string, text: string) => {
        const ref = await createModelReference(fileUri(world, name), text);
        const model = ref.object.textEditorModel;
        openFilesRef.current.set(fileKey(world, name), {
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

    // The right-click item is shown only when the cursor is on the name of something the open world declares, so not in
    // a file of another world of the adventure.
    const registerEntityAction = (editor: NonNullable<ReturnType<EditorApp['getEditor']>>, actions: EntityActions) => {
        const entityAtCursor = () => {
            const position = editor.getPosition();
            const model = editor.getModel();
            if (!position || !model) return undefined;
            const [, , world, name] = model.uri.path.split('/');
            if (name !== undefined && world !== latest.current.dlsContext.world) return undefined;
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

    /**
     * Brings the models up to date with the adventure on disk: takes up new worlds and files, re-reads a file that
     * changed, and keeps every file with unsaved edits as it is. `replace` drops all models first (another adventure).
     */
    const syncAdventure = async (replace: boolean): Promise<void> => {
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        const { adventure, world: active } = dsl;
        const app = editorAppRef.current;
        if (!app || !adventure) return;
        const request = replace ? ++loadRequestRef.current : loadRequestRef.current;

        let data: Awaited<ReturnType<typeof loader.loadAdventure>>;
        try {
            data = await loader.loadAdventure(adventure);
        } catch (e) {
            console.error('Could not load the adventure', e);
            return;
        }
        // A newer full load (another adventure, or the editor closing) wins over this one.
        if (request !== loadRequestRef.current || editorAppRef.current !== app) return;

        if (replace) {
            // The models are about to go: park the editor on the placeholder first.
            const placeholder = app.getTextModels().modified;
            if (placeholder) app.getEditor()?.setModel(placeholder);
            closeFiles();
            selectedRef.current = undefined;
        }

        const open = [...openFilesRef.current.entries()].map(([key, file]) => ({
            name: key, dirty: isDirty(file), text: file.ref.object.textEditorModel?.getValue() ?? '',
        }));
        const disk = data.worlds.flatMap(w => w.files.map(f => ({ name: fileKey(w.world, f.name), text: f.content })));
        const { add, update } = planRefresh(open, disk);
        for (const { name: key, text } of update) {
            const file = openFilesRef.current.get(key);
            file?.ref.object.textEditorModel?.setValue(text);
            if (file) file.saved = file.ref.object.textEditorModel?.getAlternativeVersionId() ?? file.saved;
        }
        for (const { name: key, text } of add) {
            const { world, name } = splitKey(key);
            if (!openFilesRef.current.has(key)) await openFile(world, name, text);
        }
        if (request !== loadRequestRef.current || editorAppRef.current !== app) return;

        setWorlds(data.worlds.map(w => ({ world: w.world, problem: w.problem })));
        publishFiles();
        if (selectedRef.current === undefined || !openFilesRef.current.has(selectedRef.current)) {
            const first = firstFile([...openFilesRef.current.keys()].map(splitKey), active);
            selectedRef.current = first && fileKey(first.world, first.name);
            setSelected(first);
            if (viewModeRef.current === 'source') showSelected();
        }
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
        await syncAdventure(true);
        if (pendingMergedRef.current !== null) await showMergedView(pendingMergedRef.current);

        console.log('Editor started');
    };

    const selectFile = (world: string, name: string) => {
        const key = fileKey(world, name);
        if (!openFilesRef.current.has(key) || key === selectedRef.current) return;
        if (viewModeRef.current === 'source') saveScroll();
        selectedRef.current = key;
        setSelected({ world, name });
        if (viewModeRef.current === 'source') showSelected();
    };

    const revealAt = (world: string, name: string, line: number) => {
        selectFile(world, name);
        const editor = editorAppRef.current?.getEditor();
        if (!editor || viewModeRef.current !== 'source') return;
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
    };

    const createFile = async (world: string, name: string): Promise<{ ok: boolean; error?: string }> => {
        const { fileContext: loader, dlsContext: dsl } = latest.current;
        try {
            const created = await loader.newFile(dsl.adventure, world, name);
            await syncAdventure(false);
            selectFile(world, created);
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
        setMerged(true);
        editor.setModel(model);
        editor.updateOptions({
            readOnly: true,
            readOnlyMessage: { value: 'This is the open world with its current state merged in. Switch back to the source to edit.' },
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
        setMerged(false);
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
        setWorlds([]);
        setSelected(undefined);
        viewRequestRef.current++;
        viewModelRef.current?.dispose();
        viewModelRef.current = null;
        viewModeRef.current = 'source';
        setMerged(false);
    };

    const saveFile = async (): Promise<{ ok: boolean; errors?: string[] }> => {
        if (viewModeRef.current === 'merged') {
            return { ok: false, errors: ['Switch back to the source view to save.'] };
        }
        const { fileContext: loader, dlsContext: dsl } = latest.current;

        // The file models, never the editor's current one: that may be the read-only merged view.
        try {
            for (const [key, open] of openFilesRef.current) {
                const model = open.ref.object.textEditorModel;
                if (!model || !isDirty(open)) continue;
                const { world, name } = splitKey(key);
                await loader.saveFile({ identifier: { adventure: dsl.adventure, world }, file: name, content: model.getValue() });
                open.saved = model.getAlternativeVersionId();
            }
        } catch (e) {
            publishFiles();
            return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
        }
        publishFiles();
        return await dsl.reloadWorld();
    };

    // Any page wrote or added a file, or another world became the open one (a new world may have been made): take up
    // what is new, keeping the edits that are not saved.
    useEffect(() => {
        if (editorAppRef.current) void syncAdventure(false);
    }, [dlsContext.filesVersion, dlsContext.world]);

    // Another adventure was opened (by any page): the editor shows that one instead.
    useEffect(() => {
        if (dlsContext.adventure && editorAppRef.current) void syncAdventure(true);
    }, [dlsContext.adventure]);

    return (
        <MonacoContext.Provider value={{
            startEditor, hasUnsavedChanges, disposeEditor, saveFile, showMergedView, showSourceView,
            worlds, files, selected, merged, selectFile, revealAt, createFile,
        }}>
            {children}
        </MonacoContext.Provider>
    );
}
