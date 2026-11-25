# D&D DSL

A domain-specific language and web toolchain for running tabletop RPG campaigns.
A Dungeon Master describes a world as text (locations, NPCs, quests, events, factions, functions, variables),
and the app turns that text into a live, playable, editable campaign: an interpreter runs the rules,
a language server edits the source, and a web UI shows the world as maps and pages.

**Tech:** TypeScript, [Langium](https://langium.org/), NestJS, React, Vite, Monaco + Language Server Protocol, WebSockets, Vitest.

## Highlights

- **A real language, not a config format.** Custom grammar, cross-reference linking, scoping rules and a semantic
  validator built on Langium. Names are scoped per world, sublocations and objectives may repeat under different
  parents, and a script file links against the world it runs on.
- **Language server in the browser.** The Monaco editor talks LSP over a WebSocket to a NestJS gateway, with custom
  completion (member access, entity names), diagnostics, and "open view" navigation from source to page.
- **Interpreter with undo/redo.** The parsed world is immutable; runtime changes live in a state overlay.
  Every user action is one command and one history entry, including cascading events, functions and
  scheduled reminders, restored from state snapshots.
- **Reactive scripting.** `on change` / `on trigger` handlers, a quest and objective status system, user-defined
  arrays, `for` loops, predefined functions (dice and random tables), an in-game clock and reminders.
- **Multi-file worlds and multi-world adventures.** A world can be one `.dnd` file or a folder of peer files,
  glued into one document with diagnostics mapped back to `file:line`. Worlds in an adventure can read from
  and link to each other, checked on load.
- **Interactive frontend.** World map (`@xyflow/react`) with auto-layout and background images, plus location,
  NPC, quest, event, faction and script pages. Every command, undo and reparse is broadcast to all open
  pages over WebSocket.
- **Three evaluators, one set of operators.** Backend (live AST, with side effects), canonical (serialized model)
  and frontend (UI-shaped) expression evaluators share their operator logic.

## A taste of the language

```
world "WorldName"

location "Forest Of The Damned"
	exit "Through the dense forest" to "Cozy Village"
	let DangerLevel = 100

location "Cozy Village"
	entry "Village Square"
	sublocations
		location "Riverside Tavern"
			exit "Front Door" to "Village Square"

		location "Village Square"
			exit "Enter Forest" to "Forest Of The Damned"
	end

quest "Rising Dead"
	enabled on true

	objective "Gather Bone Fragments"
		description
			"Gather bone fragments from the fallen Undead."
```

## Repository layout

Three independent npm projects (no root `package.json`, no shared `node_modules`):

| Directory | What | Port |
| --- | --- | --- |
| [`dnd-dsl/`](dnd-dsl) | Langium language definition (grammar, validator, scoping, evaluators, CLI). The canonical source of the DSL. | - |
| [`dnd-dsl-backend/`](dnd-dsl-backend) | NestJS server: HTTP API, command/undo-redo service, interpreter, WebSocket LSP gateway and live-sync gateway. | 3000 |
| [`dnd-dsl-frontend/`](dnd-dsl-frontend) | React + Vite app: Monaco editor, map and entity pages. | 5173 |

```
 .dnd files ──> Langium language (dnd-dsl) ──copied into──> backend + frontend
                                                              |
 Browser (React, Monaco) <-- HTTP / WebSocket --> NestJS (interpreter, commands, LSP, state sync)
                                                              |
                                           <world>.state.json overlay beside the source
```

The language package is mirrored (byte-copied) into the backend and frontend by `dnd-dsl/copy-files.cjs`,
so both always run the exact same grammar and evaluators. See
[docs/explanations/ARCHITECTURE.md](docs/explanations/ARCHITECTURE.md) for the full design.

## Getting started

Requires Node.js and npm.

```sh
# 1. Language package: generate the parser, then mirror it into backend and frontend
cd dnd-dsl
npm install
cd packages/language && npx langium generate && cd ../..
node copy-files.cjs

# 2. Backend (http://localhost:3000)
cd ../dnd-dsl-backend
npm install
npm run start:dev

# 3. Frontend (http://localhost:5173)
cd ../dnd-dsl-frontend
npm install
npm run dev
```

On first run the app asks for a **source folder** (any folder outside the repo). It holds your adventures as
`<adventure>/<world>.dnd` files with their saved state. Pick one, create a world, and open `/editor`.

After changing anything under `dnd-dsl/packages/language/src/`, re-run `npx langium generate` (only if the
grammar changed) and `node copy-files.cjs`.

## Tests

```sh
cd dnd-dsl/packages/language && npx vitest run     # language, evaluators, completion, state
cd dnd-dsl-frontend && npm test                    # pure logic: map coordinates, layout, graph, edge geometry
cd dnd-dsl-backend && npm test                     # Jest, non-parser services
```
