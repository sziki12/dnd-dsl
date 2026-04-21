import { createContext, useContext, useEffect, useState } from 'react';
import * as vscode from 'vscode';
import { MonacoVscodeApiWrapper, type MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LanguageClientWrapper, type LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
export const MonacoContext = createContext<any>(null);

export function MonacoContextNode({ children }: { children: React.ReactNode }) {
    const [apiWrapper, setAPIWrapper] = useState<MonacoVscodeApiWrapper | null>(null);
    const [lcWrapper, setLCWrapper] = useState<LanguageClientWrapper | null>(null);
    const [editorApp, setEditorApp] = useState<EditorApp | null>(null);
    const [loaded,setLoaded] = useState<boolean>(false);

    const languageId = 'dnd-dsl';
    const code = '// initial editor content';
    const codeUri = '/workspace/hello.mylang';
    // editor app / monaco-editor configuration
    const editorAppConfig: EditorAppConfig = {
        codeResources: {
            original: {
                text: code,
                uri: codeUri
            }
        }
    };

    const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'extended',
    // ADD THIS SECTION:

    serviceOverrides: {
        userServices: {
            ...getConfigurationServiceOverride(),
            ...getKeybindingsServiceOverride(),
            ...getTextmateServiceOverride(),
            ...getThemeServiceOverride(),
        },
        debugLogging: true
    },
    viewsConfig: {
        $type: 'EditorService'
    },
    userConfiguration: {
        json: JSON.stringify({
            'workbench.colorTheme': 'Default Dark Modern',
            'editor.wordBasedSuggestions': 'off'
        })
    },
    monacoWorkerFactory: configureDefaultWorkerFactory
};

    // Language client configuration
    const languageClientConfig: LanguageClientConfig = {
        languageId: languageId,
        connection: {
            options: {
                $type: 'WebSocketUrl',
                // at this url the language server for dnd-dsl must be reachable
                url: 'ws://localhost:3000/ls'
            }
        },
        clientOptions: {
            documentSelector: [languageId],
            workspaceFolder: {
                index: 0,
                name: 'workspace',
                uri: vscode.Uri.file('/workspace')
            }
        },
    };
    const startApi= async () => {
        if(loaded) {
            return;
        }
        console.log('Starting API');
        // Create the monaco-vscode api Wrapper and start it before anything else
        const apiWrapperLocal = new MonacoVscodeApiWrapper(vscodeApiConfig);
        setAPIWrapper(apiWrapperLocal);
        await apiWrapperLocal.start();

        // Create language client wrapper
        const lcWrapperLocal = new LanguageClientWrapper(languageClientConfig);
        setLCWrapper(lcWrapperLocal);
        await lcWrapperLocal.start();       
        console.log('API started');
        setLoaded(true);
    };

    const startEditor = async (element: HTMLDivElement) => {
        console.log('Starting editor');
        // Create and start the editor app
        var editorAppLocal: EditorApp
        if(editorApp === null) {
            editorAppLocal = new EditorApp(editorAppConfig);
            setEditorApp(editorAppLocal);
        }
        else {
            editorAppLocal = editorApp;
        }
        await editorAppLocal.start(element);
        console.log('Editor started');
    }

    const disposeEditor = async () => {
        await editorApp?.dispose();
        console.log('Editor disposed');
    }

  useEffect(() => {
    try {
        startApi();
    }
    catch (error) {
        console.error('Error starting API:', error);
    }
  }, []);
  return (
    <MonacoContext.Provider value={{ startEditor, disposeEditor }}>
      {children}
    </MonacoContext.Provider>
  )
}