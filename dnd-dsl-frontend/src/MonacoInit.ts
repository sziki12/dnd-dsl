import * as vscode from 'vscode';
import { MonacoVscodeApiWrapper, type MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LanguageClientWrapper, type LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';

const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'extended',
    serviceOverrides: {
        userServices: {
            ...getConfigurationServiceOverride(),
            ...getKeybindingsServiceOverride(),
            ...getTextmateServiceOverride(),
            ...getThemeServiceOverride(),
        },
        debugLogging: true
    },
    viewsConfig: { $type: 'EditorService' },
    userConfiguration: {
        json: JSON.stringify({
            'workbench.colorTheme': 'Default Dark Modern',
            'editor.wordBasedSuggestions': 'off'
        })
    },
    monacoWorkerFactory: configureDefaultWorkerFactory
};

const languageClientConfig: LanguageClientConfig = {
    languageId: 'dnd-dsl',
    connection: {
        options: {
            $type: 'WebSocketUrl',
            url: 'ws://localhost:3000/ls'
        }
    },
    clientOptions: {
        documentSelector: ['dnd-dsl'],
        workspaceFolder: {
            index: 0,
            name: 'workspace',
            uri: vscode.Uri.file('/workspace')
        }
    },
};

// Module-level promise — guaranteed to run once no matter how many
// times React mounts/unmounts/HMR-replaces the consuming component.
let initPromise: Promise<{
    apiWrapper: MonacoVscodeApiWrapper;
    lcWrapper: LanguageClientWrapper;
}> | null = null;

export function getMonacoInit() {
    if (!initPromise) {
        initPromise = (async () => {
            console.log('Starting Monaco API (once)');
            const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig);
            await apiWrapper.start();

            const lcWrapper = new LanguageClientWrapper(languageClientConfig);
            await lcWrapper.start();

            console.log('Monaco API started');
            return { apiWrapper, lcWrapper };
        })();
    }
    return initPromise;
}