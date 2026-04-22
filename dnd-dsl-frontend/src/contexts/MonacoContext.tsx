import { createContext, useEffect, useState } from 'react';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { getMonacoInit } from '../MonacoInit';

export const MonacoContext = createContext<any>(null);

const editorAppConfig: /*EditorAppConfig*/ any = {
    codeResources: {
        original: {
            text: '// initial editor content',
            uri: '/workspace/hello.mylang'
        }
    }
};

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    const [editorApp, setEditorApp] = useState</*EditorApp*/ any | null>(null);

    useEffect(() => {
        // Kick off init — safe to call multiple times, returns same promise
        getMonacoInit().catch(console.error);
    }, []);

    const startEditor = async (element: HTMLDivElement) => {
        // Wait for API to be ready before mounting editor
        await getMonacoInit();
        const app = editorApp ?? new EditorApp(editorAppConfig);
        if (!editorApp) setEditorApp(app);
        await app.start(element);
    };

    const disposeEditor = async () => {
        await editorApp?.dispose();
    };

    return (
        <MonacoContext.Provider value={{ startEditor, disposeEditor }}>
            {children}
        </MonacoContext.Provider>
    );
}