import { Location, LocationChain } from "../../../language/src/generated/ast.js";
import { mapVariablesToObject } from "./expression-parser.js";


export function parseLocations(locations: Location[]): any
    {
        let outLocations: any[] = []
        for (let location of locations)
        {
            let object = 
            {
                name: location.name, 
                entry: mapLocationChain(location.entry?.entry), 
                exits: location.exits.map(exit => {
                    return  {
                        name: exit.name,
                        locations: mapLocationChain(exit.exit)
                    }
                }),
                locations: parseLocations(location.sublocations),
                ...mapVariablesToObject(location.variables)
            }
            
            outLocations.push(object);
        }
        return outLocations
    }

    function mapLocationChain(locationChain: LocationChain | undefined)
    {
        if(typeof(locationChain) == "undefined")
        {
            return undefined
        }
        return locationChain.locations.map(location => location.$refText)
    }

    