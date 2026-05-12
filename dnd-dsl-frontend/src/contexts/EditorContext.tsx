import { createContext, useContext, useRef, useState } from 'react';
import { BackendURL } from './BackendContext';

type EditorContext = {
    loadFile: (adventure: string, world: string) => Promise<FileDto>,
    saveFile: (file: FileDto) => Promise<void>,
    loaded: boolean
}
export const EditorContext = createContext<EditorContext>({loaded: false} as EditorContext);

type FileDto = {
    identifier:{
        world: string,
        adventure: string,
    },
    content: string
}

export function EditorContextNode({ children }: { children: React.ReactNode }) {
    const fileEndpoint = `${BackendURL}/file`
    const [loaded, setLoaded] = useState(true)

    const loadFile = async (adventure: string, world: string) : Promise<FileDto> =>
    {
        const endpoint = `${fileEndpoint}/load?adventure=${adventure}&world=${world}`
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
                identifier: {
                    adventure: file.identifier.adventure,
                    world: file.identifier.world
                },
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