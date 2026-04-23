import * as vscode from 'vscode';
import { MonacoVscodeApiWrapper, type MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LanguageClientWrapper, type LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import { BaseLanguageClient } from 'vscode-languageclient';
import { Uri } from 'vscode';

export function toMonacoUri(path: string): string {
    return 'file:///' + path
        .replace(/\\/g, '/')           // backslashes to forward slashes
        .replace(/ /g, '%20');          // encode spaces only
}

const BACKEND_PATH = 'C:/Users/Szikszai Levente/Documents/GitHub/dnd-dsl/dnd-dsl-backend';
const WORKSPACE_URI = Uri.file(BACKEND_PATH);
export const FILE_URI = Uri.file(`${BACKEND_PATH}/test_file.dnd`);

const WORKSPACE_URI_STRING = toMonacoUri(BACKEND_PATH);

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
            // Editor appearance
            'workbench.colorTheme': 'Default Dark Modern',
            'editor.fontSize': 14,
            'editor.fontFamily': 'Consolas, monospace',

            // Editor behavior
            'editor.tabSize': 2,
            'editor.wordWrap': 'on',
            'editor.minimap.enabled': true,
            'editor.lineNumbers': 'on',

            // Language features
            'editor.quickSuggestions': true,
            'editor.wordBasedSuggestions': 'off',
            'editor.parameterHints.enabled': true,

            // Advanced features
            'editor.experimental.asyncTokenization': true,
            'editor.guides.bracketPairsHorizontal': 'active'
        })
    },
     extensions: [{
        config: {
            name: 'dnd-dsl',
            publisher: 'dnd-dsl',
            version: '1.0.0',
            engines: { vscode: '*' },
            contributes: {
                languages: [{
                id: 'dnd-dsl',
                extensions: ['.dnd'],
                aliases: ['DnD DSL']
                }],
                grammars: [{
                language: 'dnd-dsl',
                scopeName: 'source.dnd-dsl',
                path: './dnd-language/extension/syntaxes/dnd-dsl.tmLanguage.json'
                }]
            }
        },
        //uri: `${window.location.origin}/extensions/dnd-dsl`
    }],
    monacoWorkerFactory: configureDefaultWorkerFactory
};

console.log("WORKSPACE_URI_STRING", Uri.parse(WORKSPACE_URI_STRING).toString());
const languageClientConfig: LanguageClientConfig = {
    languageId: 'dnd-dsl',
    connection: {
        options: {
            $type: 'WebSocketUrl',
            url: 'ws://localhost:3000/ls',
            startOptions: {
                onCall: (languageClient?: BaseLanguageClient) => {
                    console.log(`Language: ${languageClient?.name}, Running: ${languageClient?.isRunning()}`);
                },
                reportStatus: true
            }
        }
    },
    clientOptions: {
        documentSelector: ['dnd-dsl'],
        workspaceFolder: {
            index: 0,
            name: 'workspace',
            uri: Uri.parse(WORKSPACE_URI_STRING)
        },
        initializationOptions: {
            workspaceUri: WORKSPACE_URI_STRING
        }
    },
};

// Module-level promise — guaranteed to run once no matter how many
// times React mounts/unmounts/HMR-replaces the consuming component.
let initPromise: Promise<{
    apiWrapper: MonacoVscodeApiWrapper;
    lcWrapper: LanguageClientWrapper;
}> | null = null;

/*export function getMonacoInit() {
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
}*/
export function getMonacoInit() {
    const g = globalThis as any;
    const MONACO_INIT_KEY = '__MONACO_INIT_PROMISE__';

    if (!g[MONACO_INIT_KEY]) {
        g[MONACO_INIT_KEY] = (async () => {
            console.log('Starting Monaco API (once)');
            try {
                const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig);
                console.log('MonacoVscodeApiWrapper created');
                
                await apiWrapper.start();
                console.log('apiWrapper.start() done');

                const lcWrapper = new LanguageClientWrapper(languageClientConfig);
                console.log('LanguageClientWrapper created');

                await lcWrapper.start();
                console.log('lcWrapper.start() done');

                console.log('Monaco API started');
                return { apiWrapper, lcWrapper };
            } catch (e) {
                // Clear the promise so a page reload can retry
                g[MONACO_INIT_KEY] = null;
                console.error('Monaco init failed at:', e);
                throw e;
            }
        })();
    }

    return g[MONACO_INIT_KEY];
}