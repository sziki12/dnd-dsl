# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three **independent** npm projects in one git repo. There is no root `package.json`, no
workspace tool linking them, and no shared `node_modules` — run `npm install` in each.

| Dir | What | Runtime |
| --- | --- | --- |
| `dnd-dsl/` | Langium language definition (npm workspace: `packages/language`, `packages/cli`, `packages/extension`). The **canonical source of the DSL.** | Node / ESM |
| `dnd-dsl-backend/` | NestJS server — HTTP API + a WebSocket LSP gateway. Port **3000**. | NestJS 11, ESM (`module: nodenext`) |
| `dnd-dsl-frontend/` | React + Vite app — Monaco editor + `@xyflow/react` graph views. Port **5173**. | React 19, Vite |

## The language mirror mechanism (read this first)

`dnd-dsl/packages/language/src/` is the **single source of truth** for the DSL (grammar,
generated AST, custom Langium services, evaluators, serialized-model helpers).

`dnd-dsl/copy-files.cjs` byte-copies that directory (plus `packages/cli/src` and the
extension's TextMate grammar) into:
- `dnd-dsl-backend/src/dnd-language/**`
- `dnd-dsl-frontend/src/dnd-language/**`

**Both mirrors are `.gitignore`d** and only exist locally. So is `packages/language/src/generated/`.
The backend imports the mirror as `@dnd-language/*` (tsconfig paths + jest `moduleNameMapper`);
the frontend as `@dnd-language` / `@dnd-cli` (Vite alias + tsconfig paths).

**After editing anything under `dnd-dsl/packages/language/src/`:**
1. If you touched `dnd-dsl.langium`: `cd dnd-dsl/packages/language && npx langium generate`
   (regenerates `src/generated/`).
2. `cd dnd-dsl && node copy-files.cjs` — refreshes both mirrors.
3. Backend `nest start --watch` rebuilds and restarts from the new mirror; Vite HMR picks up
   the frontend mirror. A **full browser reload** is needed when LSP server capabilities
   change (e.g. completion trigger characters).

Never edit files under `*/src/dnd-language/` directly — they are overwritten.

## Commands

### Language package (`dnd-dsl/packages/language/`)
- `npx vitest run` — full test suite (or `npm test` here, or `npm test` from `dnd-dsl/`).
- `npx vitest run test/completion.test.ts` — one file. `npx vitest run -t "member completion"` — one test by name.
- `npx tsc --noEmit` — typecheck.
- `npx langium generate` — regenerate `src/generated/` from the grammar.
- **Baseline:** `test/linking.test.ts`, `test/parsing.test.ts`, `test/validating.test.ts` are
  empty scaffold stubs that report `No test found in suite`. That is expected, not a regression.

### Backend (`dnd-dsl-backend/`)
- `npm run start:dev` — watch mode (webpack bundle → `dist/main.js`, restarts on change).
- `npm run build` — one-off build. `npm run lint` (eslint --fix). `npx tsc --noEmit`.
- `npm test` — Jest (`*.spec.ts`).
- **Jest cannot load `langium` (ESM under ts-jest).** Anything that exercises the parser /
  interpreter / scope providers is *not* unit-tested here — verify it with `npx tsc --noEmit`
  + the canonical Vitest suite + a browser check instead.
- **Baseline:** `npx tsc --noEmit` reports one pre-existing error in
  `src/dnd-language/cli/src/main.ts` (`import.meta` in a CommonJS file).

### Frontend (`dnd-dsl-frontend/`)
- `npm run dev` — Vite dev server (needs the backend running on :3000).
- `npm run build` — `tsc -b && vite build`. `npm run lint`. `npx tsc -b --noEmit`.
- `npm test` - Vitest, for pure logic only (`pages/map-coords`, `pages/map-view-settings`, `pages/map-image`, `pages/exit-tags`, `pages/auto-layout`, `pages/map-graph`, `common/state-path-text`, `edges/edge-geometry`); components are checked in the browser.
- **Baseline:** `npx tsc -b --noEmit` reports ~26 pre-existing unused-import errors.

### Running the app
There is no config file. The **source folder** (an absolute path *outside the repo*) is chosen in the app (first run
shows a folder browser; File > Change source folder...) and remembered, with the last-opened world, in a user settings
file (`%APPDATA%/dnd-dsl/settings.json`, `~/Library/Application Support/dnd-dsl/` or `~/.config/dnd-dsl/`;
`DND_DSL_SETTINGS` names the file for tests). It holds `<adventure>/<world>.dnd` (or a folder `<adventure>/<world>/` of
equal `.dnd` files, see the multi-file note below) and its `<world>.state.json` sidecar (the map page also keeps `<world>.layout.json` and `<world>.mapview.json` there, and a location's background image lives in `Maps/<location key>/` named by `Maps.json`; the key is the location's path of names, see the frontend note). The frontend loads a world with
`POST /parse?adventure=<a>&world=<w>`, then `GET /world`.

## Architecture

### The DSL
- Langium 4.2 grammar in `packages/language/src/dnd-dsl.langium`. A `.dnd` file is one
  `World`. A **script file** starts with `reference world "Name"` and also parses as a
  `World` node (second alternative of the `World` rule) so `Model.World` stays required.
- Custom services wired in `dnd-dsl-module.ts`:
  - `DndScopeProvider` — `.`-member access scoping on `RefChain`, and `State::Value` refs.
  - `DndScopeComputation` — exports a world's entities to the **global** index (Langium
    exports only `Model`'s direct children by default), so a separately-parsed script
    document links its `location "X"` / `trigger "E"` / `call fn` against the world doc.
  - `DndCompletionProvider` — `.`-member completion and entity-name (`location "…"`,
    `npc "…"`, …) completion that Langium's built-in cross-ref completion misses in this
    grammar; also declares `.` / `"` as completion trigger characters.
  - `DndDslValidator` — uniqueness, state-value checks, `remind` placement, etc.
- A world is one `.dnd` file or a **folder of equal peer files** (`<adventure>/<world>/*.dnd`); sidecars and saved states stay
  beside it. The folder or file name is the world's name and every `world "..."` line in it must match (`mergeWorldFiles`,
  `world-files.ts`). The `World` rule accepts its header again where the next file begins (`partNames`), so the server glues
  the files one after the other (`parseWorld` in `packages/cli/src/main.ts`) and parses/validates **one document**; a source
  map turns every diagnostic back into `file:line`. Nothing else has to know about files (state paths, serialization,
  handlers, the merged state view). The editor checks each file alone and finds the other files' names through the global
  index; `world-parts.ts` (`worldParts`) lets `world . Var`, the bare-`party` rule and `world . collection[...]` see all pieces.
  Bare world-level variable names are not global, with one file or several.
- **An adventure is what is opened**; one of its worlds runs (the *active* world, the one the pages show and the server
  holds), the others are on disk. The Editor holds the files of **every** world of the adventure as models in one language
  server workspace (`MonacoContext`, keyed by `world/file`; `AdventureTree` shows worlds as collapsible items with their files
  and, for the worlds that are not active, their locations with the file and line of each). So **a name means its own
  world's**: `DndScopeProvider.getGlobalScope`, `currentPartyScope` and the completion provider's name lookups only see the
  documents of the reference's own world and the built-in document (`world-scope.ts`; the global scope is not cached,
  because Langium's cache would hold the documents of the moment it was built). Switching the active world never discards the
  Editor's unsaved edits; opening another adventure does (and asks first).
- A world can **read** another world of its adventure and have an **exit into one** (`world "Other" . npc "Ann" . Gold`,
  `exit "Door" to world "Other" -> "Hall" -> "Gate"`; bare `world` is this world, a `world` followed by a string is another).
  Never a cross-reference: the other world is not loaded into this workspace (its names would collide). `parseWorld` is
  given a preparer (`WorldRegistry.preparer`), parses each mentioned world on its own with its saved state, and
  `checkForeignReferences` (`evaluation/dnd-dsl-foreign.ts`) checks every name against it, reporting `file:line`. The
  interpreter reads through `ctx.foreign` (`readForeign`, built on `readPersistentValue`); the snapshot is as of this world's
  load and one level deep. Read-only: the validator refuses writing, `on change`, and reading inside a variable's value
  (the pages evaluate those from the served state, which holds this world only); reads work in functions, events, handlers,
  scripts and quest conditions. Collections and sublocation steps of another world are not readable yet.
- Every quest and objective has a built-in `let Status` variable, added to the parsed model right after
  each parse by `builtin-status.ts` (a parser wrapper in `dnd-dsl-module.ts`); its rules live in
  `evaluation/dnd-dsl-status.ts`. It is a normal variable for linking, `set` and `on change`, so code
  that reads a variable's `value` must evaluate it, not assume a string.
- A chain's head is `chainHead(chain)` (`evaluation/dnd-dsl-state-path.ts`), not `chain.first`: after a step down
  to a child (`location "A" -> "B"`, `quest "Q" . objectives "O"`) the head is the last step, so every reader of a
  chain goes through that helper. Steps live in `RefChain` itself; a trailing repetition at the end of a head rule
  would be predicted on its first token alone (see `docs/plans/COLLECTION_ACCESS_IDEAS.md`).
- Objective names are unique within their quest, not the world (`docs/plans/NONUNIQUE_NAMES_PLAN.md`, step A built). A bare
  objective name that more than one quest uses is a linking error from `DndLinker` (counted by quest name), except
  inside a quest that has one of that name, where it means that quest's own. `quest "Q" -> "O"` and
  `objective completed|failed quest "Q" -> "O"` say which; they keep `target` as the one cross-reference, so the
  evaluators and the handler index are unchanged. The statements always name the quest: `complete|fail objective from
  quest "Q" -> "O"` (`complete|fail quest "Q"` is the quest); the bare `complete objective "O"` and `complete quest "Q"
  -> "O"` spellings no longer parse.
- Location names are unique among siblings too (top-level locations, and the sublocations of one parent), not the
  world (`docs/plans/NONUNIQUE_NAMES_PLAN.md`, step B built). A bare location name that more than one location has is a linking
  error from `DndLinker`, except inside the parent that has it (the nearest enclosing match wins, as for
  objectives); `location "A" -> "B"` says which, and an exit target takes the same path:
  `exit "Back" to "Dungeon 1" -> "Entrance"` (`LocationExit.via` holds the names before the target; `exit` stays the
  one final cross-reference).
- The frontend identifies a location by its path of names (`common/location-identity.ts`, `docs/plans/NONUNIQUE_NAMES_PLAN.md`
  step C built): the route is `/location/<name>/<name>...` (one segment per name; a single name still finds the one
  sublocation that has it, and a shared one shows a chooser), a map node id is `locationKey(path)` (names joined by
  `\u203a`, escaped; a top-level name is its own key), and the layout, view settings and image of a location are
  filed under that key, with the old bare-name entry read as a fallback while the name is unique in the world.
  `useLocationIndex()` gives pages the `LocationIndex` (path, key and legacy key of every location).
- `packages/cli/src/main.ts` exports `parseModel()` and `DndDslParseError` (used by the backend).

### Two expression evaluators (intentional parallel implementations)
They share operator logic via `packages/language/src/evaluation/dnd-dsl-expression-operations.ts`
but are otherwise separate:
1. **Backend** `LangiumInterpreterService.evaluateExpression` — walks the **live AST**, has
   side effects (runs functions, fires events), drives `/command/*`.
2. **Canonical** `evaluation/dnd-dsl-value-evaluator.ts` `evaluateSerializedExpression(model?, expr, options?)` —
   pure, operates on the **served JSON** model; used by the backend (strict, plain records) and the frontend.
   The frontend `common/expression-evaluator.ts` is only a wrapper: `lenient: true` (a failing node is
   `undefined`, because it runs during render) and `objectOf` (builds the `SerialisedObjectDeclaration`
   the pages render, computed members left unevaluated). Every object result, including a raw record
   an overlay write stored, goes through `objectOf`. Without a model, references are `undefined`.

When changing evaluation semantics, update both (or the shared ops file).

### State model
- The parsed world is immutable. Runtime mutation lives in a `<world>.state.json`
  **overlay** sidecar. `WorldStateService` re-applies the overlay onto the model after
  every reparse (`rebuildWorldState` / `applyOverlay`).
- `StatePath` (`evaluation/dnd-dsl-state-path.ts`) is a **name-based** path
  (`{kind:'location'|'npc'|'quest'|…, name}`) that survives reparses. `nodeToStatePath` /
  `statePathToNode` convert between an AST/JSON node and a path. A sublocation is a run of `location` segments
  from a top-level one down (`[Dungeon 1, Entrance, Torches]`); an old-style lone name still resolves while exactly
  one location has it. State saved that way is rewritten on load (`dnd-dsl-state-migration.ts`), and a path an old
  client sends goes through `canonicalStatePath` first.
- Clock + scheduled reminders (`evaluation/dnd-dsl-clock.ts`, `dnd-dsl-reminders.ts`) also
  live in the overlay.

### Commands and undo/redo (`backend/src/command/`)
- One user action = one `Command` (`CALL_FUNCTION`, `TRIGGER_EVENT`, `ASSIGN_VARIABLE`,
  `ADVANCE_TIME`, `RUN_SCRIPT`, …) = one `HistoryEntry`. Cascading effects (chained
  events/functions, reminder ticks fired by one `ADVANCE_TIME`) **fold into that single
  entry** — never create sub-entries for them.
- `RuntimeStateSnapshot` captures overlay + runtime vars + clock + reminders. Undo/redo
  restore snapshots. Non-deterministic commands (random tables) store a `post` snapshot so
  redo *restores* rather than re-runs.
- `EvalContext` in the interpreter is threaded explicitly (not DI) to avoid a cycle with
  `WorldStateService`; it carries `pendingOverlayWrites` that `CommandService` flushes.

### Backend LSP
`LangiumConnectionGateway` (`langium-connection/`) — `@WebSocketGateway({ path: '/ls' })`.
Each connection builds its own services from the full `dnd-dsl-module`, so every custom
service is active for editor features. The frontend connects a `monaco-languageclient` to
`ws://localhost:3000/ls` in `src/MonacoInit.ts` (a module-level singleton).

### Frontend
- Routes (`App.tsx`): `/`, `/location/*` (one segment per name of the path), `/map`, `/npcs`, `/quests`, `/quests/:questName`,
  `/events`, `/events/:eventName`, `/script`, `/editor`.
- `contexts/DslContext.tsx` is the state hub — loads the world, holds `worldState`, exposes
  `execute` / `undo` / `redo` / `runScript`, and applies each `CommandResponse` (updating
  `worldState`, undo/redo availability, reminder toasts).
- `/editor` and `/script` share the Monaco/LSP setup from `MonacoInit.ts`. `/script` adds
  `common/useScriptEditor.ts`, which also opens the loaded world's source as an
  editor-less model so the script links against it.
- `vite.config.ts` contains extensive aliasing / `optimizeDeps` / plugin workarounds for
  `@codingame/monaco-vscode-api` and `monaco-languageclient`. Treat it as load-bearing.

## Conventions

- **Comments:** minimal. Write one only to explain a non-obvious solution (or when asked).
  Plain ASCII — no `—`, `→`, or similar glyphs.
- Match the surrounding file's style (4-space indent + double quotes in the language
  package; the frontend follows its eslint config).
- Commit subject lines are short and terse (e.g. `Completion Provider`, `Reminder and Clock handling`).
