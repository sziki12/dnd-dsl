"use strict";
export function getWorldState() {
    return {
        "locations": [{"name":"Forest Of The Damned",
"exits":[{"name":"Through the dense forest","locations":["Cozy Village"]}],"locations":[],"DangerLevel":100},{"name":"High Castle","exits":[{"name":"Front Door","locations":["Cozy Village"]}],"locations":[],"Resources":"{\"Food\":50,\"Gold\":2000,\"Soliders\":\"this[undefined(0,1)]\"}"},{"name":"Cozy Village","entry":["Village Square"],"exits":[],"locations":[{"name":"Riverside Tavern","exits":[{"name":"Back Door","locations":["Back Alle"]},{"name":"Front Door","locations":["Village Square"]}],"locations":[]},{"name":"Back Alle","exits":[{"name":"Main Street","locations":["Village Square"]}],"locations":[]},{"name":"Village Square","exits":[{"name":"Enter Forest","locations":["Forest Of The Damned"]}],"locations":[],"Resources":"{\"Food\":50,\"Gold\":2000,\"Soliders\":\"this[undefined(0,1)]\"}"}]}]
    }
}
