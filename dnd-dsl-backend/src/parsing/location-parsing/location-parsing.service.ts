import { LocationChain, World, Location } from '@dnd-language/index.js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LocationParsingService 
{

    loadLocations(worldState: Object, world: World) 
    {
        for (let location of world.locations)
        {
            worldState["locations"].push(
            {
                name: location.name, 
                entry: this.mapLocationChain(location.entry?.entry), 
                exits: location.exits.map(exit => {
                    return  {
                        name: exit.name,
                        locations: this.mapLocationChain(exit.exit)
                    }
                }),
                sublocations: location.sublocations.map(sl => sl.name),
                ...this.mapVariables(location)
            });
        }
    }

    mapLocationChain(locationChain: LocationChain | undefined)
    {
        if(typeof(locationChain) == "undefined")
        {
            return undefined
        }
        return locationChain.locations.map(location => location.$refText)
    }

    mapVariables(location : Location)
    {
        let object = {}
        for (let variable of location.variables)
        {
            object[variable.name] = 0
        }
        return object
    }
}
