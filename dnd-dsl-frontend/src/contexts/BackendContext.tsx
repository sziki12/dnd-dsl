import { createContext, useRef } from 'react';

export const BackendContext = createContext<any>(null);
export const BackendURL = "http://127.0.0.1:3000"

export function EditorContextNode({ children }: { children: React.ReactNode }) {
    

    return (
        <BackendContext.Provider value={{  }}>
            {children}
        </BackendContext.Provider>
    );
}