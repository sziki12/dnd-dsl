/*import { Location, LocationChain } from "../../../language/src/generated/ast.js";
import { popCurrentReference, pushCurrentReference } from "../generator.js";
import { mapVariablesToObject } from "./expression-parser.js";


export function parseLocations(locations: Location[], isTopLevel: boolean = false): any
    {
        let outLocations: any[] = []
        for (let location of locations)
        {
            pushCurrentReference(location)
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
                ...mapVariablesToObject(location.variables, "Declaration")
            }

            outLocations.push(object);
            popCurrentReference()
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
    }*/

    