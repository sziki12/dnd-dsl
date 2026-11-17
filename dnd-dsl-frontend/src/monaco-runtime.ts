// Everything that pulls in the Monaco/VS Code stack, behind one dynamic import so the pages that need no editor do not download it.
export { EditorApp } from 'monaco-languageclient/editorApp';
export { createModelReference } from '@codingame/monaco-vscode-api/monaco';
export { Uri } from 'vscode';
export { getMonacoInit } from './MonacoInit';
