import { createContext, useEffect, useState } from 'react';
import { BackendURL } from './BackendContext';

export const DslContext = createContext<any>(null);

export function DslContextNode({ children }: { children: React.ReactNode }) {
    const [world, setWorld] = useState("World")
    const [adventure, setAdventure] = useState("Adventure")
    const [worldState, setWorldState] = useState({})

    const stateEndpoint = `${BackendURL}/state`
    const parseWorldState = async () =>
    {
        const endpoint = `${stateEndpoint}/parse?adventure=${adventure}&world=${world}`
        console.log(`endpoint: ${endpoint}`)
        const response = await fetch(`${endpoint}`, {
            method: 'POST',
        });
        
        console.log(`Status: ${response.status}`);
        console.log('World File Parsed')
    }

    const updateWorldState = async () =>
    {
        const endpoint = `${stateEndpoint}/load?adventure=${adventure}&world=${world}`
        console.log(`endpoint: ${endpoint}`)
        const response = await fetch(`${endpoint}`, {
            method: 'GET',
        });
        
        console.log(`Status: ${response.status}`);
        const responseJson = await response.json()
        console.log('World State loaded');
        setWorldState(responseJson)
    }

    const updateWorld = async (newWorld: string) =>
    {
        setWorld(newWorld)
    }

    const updateAdventure = async (newAdventure: string) =>
    {
        setAdventure(newAdventure)
    }

    useEffect(()=>{
        if(typeof(world) == "undefined" || typeof(adventure) == "undefined")
            return
        parseWorldState().then(updateWorldState)
    },[world, adventure])

    return (
        <DslContext.Provider value={{ world, updateWorld, adventure, updateAdventure, worldState, updateWorldState }}>
            {children}
        </DslContext.Provider>
    );
}