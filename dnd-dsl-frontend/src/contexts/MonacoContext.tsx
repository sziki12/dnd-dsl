import { createContext, useRef } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { FILE_URI, getMonacoInit, toMonacoUri } from '../MonacoInit';

export const MonacoContext = createContext<any>(null);

const FILE_URI_STRING = toMonacoUri(`${FILE_URI.fsPath}`);

const editorAppConfig: EditorAppConfig = {
    codeResources: {
        /*original: {
            text: '// initial editor content',
            uri: FILE_URI_STRING,
            enforceLanguageId: 'dnd-dsl',
        },*/
        modified: {
            text: '// modified editor content',
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
};

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    // useRef instead of useState — survives re-renders without stale closures,
    // and mutations don't trigger re-renders
    const editorAppRef = useRef<EditorApp | null>(null);

    const startEditor = async (element: HTMLDivElement) => {
        await getMonacoInit()
        .then(() => console.log('MonacoContext: init complete'))
        .catch((e: any) => console.error('MonacoContext: init failed', e));

        // If a disposed or stale instance exists, always create a fresh one
        if (editorAppRef.current) {
            await editorAppRef.current.dispose().catch(() => {});
            editorAppRef.current = null;
        }

        console.log('FILE_URI_STRING:', FILE_URI_STRING.toString());
        console.log('editorAppConfig:', JSON.stringify({
            ...editorAppConfig,
            codeResources: editorAppConfig.codeResources
        }, null, 2));

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

    return (
        <MonacoContext.Provider value={{ startEditor, disposeEditor }}>
            {children}
        </MonacoContext.Provider>
    );
}