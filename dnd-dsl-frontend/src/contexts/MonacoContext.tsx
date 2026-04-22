import { createContext, useRef } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { FILE_URI, getMonacoInit } from '../MonacoInit';

export const MonacoContext = createContext<any>(null);

console.log(FILE_URI);
const editorAppConfig: EditorAppConfig = {
    codeResources: {
        original: {
            text: '// initial editor content',
            uri: FILE_URI.toString()
        }
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

        const app = new EditorApp(editorAppConfig);
        editorAppRef.current = app;
        await app.start(element);
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