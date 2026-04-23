import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { FILE_URI, getMonacoInit, toMonacoUri } from '../MonacoInit';
import { EditorContext } from '../contexts/EditorContext';

export const MonacoContext = createContext<any>(null);

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    const editorAppRef = useRef<EditorApp | null>(null);
    const editorContext = useContext(EditorContext);

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

    const startEditor = async (element: HTMLDivElement) => {
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

        console.log('URI:', app?.getEditor()?.getModel()?.uri.toString(), 'Language:', app?.getEditor()?.getModel()?.getLanguageId());
        console.log('Editor started');
    };

    const disposeEditor = async () => {
        if (editorAppRef.current) {
            await editorAppRef.current.dispose();
            editorAppRef.current = null; // ← clear ref so next startEditor creates fresh
            console.log('Editor disposed');
        }
    };

    const saveFile = async () => {
        const content = editorAppRef.current?.getEditor()?.getModel()?.getValue();
        if (!content) return;

        await editorContext?.saveFile({name: "", content: content})
        console.log('File saved');
    };

    useEffect(()=>{
        if(!editorContext.loaded)
            return

        editorContext.loadFile("").then(file => {
            editorAppRef.current?.updateCode({modified:file.content})
            editorAppConfig = getEditorConfig(file.content)
        });
    },[editorContext.loaded])

    return (
        <MonacoContext.Provider value={{ startEditor, disposeEditor, saveFile }}>
            {children}
        </MonacoContext.Provider>
    );
}
