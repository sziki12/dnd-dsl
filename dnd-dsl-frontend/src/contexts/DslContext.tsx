import { createContext, useEffect, useState } from 'react';
import { BackendURL } from './BackendContext';
import type { SerializedModel, SerializedWorld } from '../common/model-types';

type DslContext = {
    world: string,
    updateWorld: (newWorld: string) => Promise<void>,
    adventure: string,
    updateAdventure: (newAdventure: string) => Promise<void>,
    worldState: SerializedModel | undefined,
    updateWorldState: () => Promise<void>,
    getByReference<T extends object>(ref: string | undefined): T | undefined
}

export const DslContext = createContext<DslContext>({} as DslContext);

export function DslContextNode({ children }: { children: React.ReactNode }) {
    const [world, setWorld] = useState("World")
    const [adventure, setAdventure] = useState("Adventure")
    const [worldState, setWorldState] = useState<SerializedModel | undefined>(undefined)

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

    const getByReference = <T extends object>(ref: string | undefined): T | undefined => {
        if (!worldState || !ref) return undefined;

        var referencePath = ref.split("#/World/")[1].split("/");
        if(referencePath.length == 0)            
            return undefined;
        var current : any = worldState.World;
        for(let i = 0; i < referencePath.length; i++){
            var part = referencePath[i];
            console.log(`Resolving part: ${part}`);
            

            if(part.includes("@")){
                var [arrayName, id] = part.split("@");
                if(current[arrayName] === undefined || !Array.isArray(current[arrayName]))
                    return undefined;

                current = current[arrayName][id];
                if(current === undefined)
                    return undefined;
            }
            else if(current[part] === undefined) {
                return undefined;
            }
            else{
                current = current[part];
            }
        }
        return current;
    }

    useEffect(()=>{
        if(typeof(world) == "undefined" || typeof(adventure) == "undefined")
            return
        parseWorldState().then(updateWorldState)
    },[world, adventure])

    return (
        <DslContext.Provider value={{ world, updateWorld, adventure, updateAdventure, worldState, updateWorldState, getByReference }}>
            {children}
        </DslContext.Provider>
    );
}