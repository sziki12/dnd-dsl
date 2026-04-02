"use strict";
export function getWorldState() {
    return {
  "locations": [
    {
      "name": "Forest Of The Damned",
      "exits": [
        {
          "name": "Through the dense forest",
          "locations": [
            "Cozy Village"
          ]
        }
      ],
      "locations": [],
      "DangerLevel": 100
    },
    {
      "name": "High Castle",
      "exits": [
        {
          "name": "Front Door",
          "locations": [
            "Cozy Village"
          ]
        }
      ],
      "locations": [],
      "Resources": {
        "Food": 50,
        "Gold": 2000,
        "Soliders": 0
      }
    },
    {
      "name": "Cozy Village",
      "entry": [
        "Village Square"
      ],
      "exits": [],
      "locations": [
        {
          "name": "Riverside Tavern",
          "exits": [
            {
              "name": "Back Door",
              "locations": [
                "Back Alle"
              ]
            },
            {
              "name": "Front Door",
              "locations": [
                "Village Square"
              ]
            }
          ],
          "locations": []
        },
        {
          "name": "Back Alle",
          "exits": [
            {
              "name": "Main Street",
              "locations": [
                "Village Square"
              ]
            }
          ],
          "locations": []
        },
        {
          "name": "Village Square",
          "exits": [
            {
              "name": "Enter Forest",
              "locations": [
                "Forest Of The Damned"
              ]
            }
          ],
          "locations": [],
          "Resources": {
            "Food": 50,
            "Gold": 2000,
            "Soliders": 0
          }
        }
      ]
    }
  ]
}
}

export function callFunction(name, options) {
    let worldState = options["worldState"]

    if(options.isPredefined)
    {
        return worldState.functions[name](...options.params)
    }
    return worldState.functions[name](...options.params)
}

export function callPredefinedFunction(name, options) {
    let worldState = options["worldState"]

    //TODO Resolve predefined functions
    return undefined//worldState.functions[name](...options.params)
}

export function initWorldState(worldState) {
    worldState["Soliders"]=callFunction("undefined", {params: [50,100], worldState: worldState})
    worldState["Soliders"]=callFunction("undefined", {params: [50,100], worldState: worldState})
}
