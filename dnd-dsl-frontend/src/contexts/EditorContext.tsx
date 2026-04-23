import { createContext, useRef, useState } from 'react';
import { BackendURL } from './BackendContext';

type EditorContext = {
    loadFile: (name: string) => Promise<FileDto>,
    saveFile: (file: FileDto) => any,
    loaded: boolean
}
export const EditorContext = createContext<EditorContext>({loaded: false} as EditorContext);

type FileDto = {
    name: string,
    content: string
}

export function EditorContextNode({ children }: { children: React.ReactNode }) {
    const fileEndpoint = `${BackendURL}/file`
    const [loaded, setLoaded] = useState(true)

    const loadFile = async (name: string) : Promise<FileDto> =>
    {
        const endpoint = `${fileEndpoint}/load?name=test_file.dnd`
        console.log(`endpoint: ${endpoint}`)
        const response = await fetch(`${endpoint}`, {
            method: 'GET',
        });
        
        console.log(`Status: ${response.status}`);
        const responseDto = await response.json()
        console.log(responseDto)
        console.log('File loaded');
        return responseDto
    }

    const saveFile = async (file: FileDto) =>
    {
         await fetch(`${fileEndpoint}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'test_file.dnd',
                content: file.content
            })
        });
        console.log('File saved');
    }

    return (
        <EditorContext.Provider value={{ loadFile, saveFile, loaded }}>
            {children}
        </EditorContext.Provider>
    );
}