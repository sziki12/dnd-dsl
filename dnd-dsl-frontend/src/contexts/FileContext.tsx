import { createContext, useState } from 'react';
import { BackendURL } from './BackendContext';

type FileContext = {
    /** The files a world is written in: one, or the equal parts of its folder. */
    listFiles: (adventure: string, world: string) => Promise<WorldFileList>,
    /** One of the world's files; `file` may be left out for a world of one file. */
    loadFile: (adventure: string, world: string, file?: string) => Promise<FileDto>,
    saveFile: (file: FileDto) => Promise<void>,
    /** Adds a file to the world and returns its name. */
    newFile: (adventure: string, world: string, file: string) => Promise<string>,
    loaded: boolean
}
export const FileContext = createContext<FileContext>({loaded: false} as FileContext);

export type WorldFileList = {
    kind: 'file' | 'folder',
    files: string[],
}

type FileDto = {
    identifier:{
        world: string,
        adventure: string,
    },
    content: string,
    file?: string,
}

/** The backend's rejection text: Nest's `message` is a string, or a list for validation errors. */
async function readJson<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const message = body?.message
        throw new Error(typeof message === 'string' ? message : `Request failed (${response.status})`)
    }
    return body as T
}

export function FileContextNode({ children }: { children: React.ReactNode }) {
    const fileEndpoint = `${BackendURL}/file`
    const [loaded] = useState(true)
    const query = (adventure: string, world: string) => `adventure=${encodeURIComponent(adventure)}&world=${encodeURIComponent(world)}`

    const listFiles = async (adventure: string, world: string) : Promise<WorldFileList> =>
        readJson(await fetch(`${fileEndpoint}/list?${query(adventure, world)}`))

    const loadFile = async (adventure: string, world: string, file?: string) : Promise<FileDto> =>
        readJson(await fetch(`${fileEndpoint}/load?${query(adventure, world)}${file === undefined ? '' : `&file=${encodeURIComponent(file)}`}`))

    const saveFile = async (file: FileDto) =>
    {
        await readJson(await fetch(`${fileEndpoint}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: {
                    adventure: file.identifier.adventure,
                    world: file.identifier.world
                },
                file: file.file,
                content: file.content
            })
        }))
    }

    const newFile = async (adventure: string, world: string, file: string) : Promise<string> =>
        (await readJson<{ file: string }>(await fetch(`${fileEndpoint}/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adventure, world, file }),
        }))).file

    return (
        <FileContext.Provider value={{ listFiles, loadFile, saveFile, newFile, loaded }}>
            {children}
        </FileContext.Provider>
    );
}
