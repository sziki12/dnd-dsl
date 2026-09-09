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
- No test runner is configured.
- **Baseline:** `npx tsc -b --noEmit` reports ~26 pre-existing unused-import errors.

### Running the app
Backend reads `dnd-dsl-backend/config/config.json` (**tracked**, machine-specific):
`DefaultFilePath` is an absolute path *outside the repo* holding `<adventure>/<world>.dnd`
and its `<world>.state.json` sidecar. The frontend loads a world with
`POST /parse?adventure=<a>&world=<w>`, then `GET /world`.

## Architecture

### The DSL
- Langium 4.2 grammar in `packages/language/src/dnd-dsl.langium`. A `.dnd` file is one
  `World`. A **script file** starts with `reference world "Name"` and also parses as a
  `World` node (second alternative of the `World` rule) so `Model.World` stays required.
- Custom services wired in `dnd-dsl-module.ts`:
  - `DndScopeProvider` — `.`-member access scoping on `RefChain`, and `Enum::Value` refs.
  - `DndScopeComputation` — exports a world's entities to the **global** index (Langium
    exports only `Model`'s direct children by default), so a separately-parsed script
    document links its `location "X"` / `trigger "E"` / `call fn` against the world doc.
  - `DndCompletionProvider` — `.`-member completion and entity-name (`location "…"`,
    `npc "…"`, …) completion that Langium's built-in cross-ref completion misses in this
    grammar; also declares `.` / `"` as completion trigger characters.
  - `DndDslValidator` — uniqueness, enum-value checks, `remind` placement, etc.
- `packages/cli/src/main.ts` exports `parseModel()` and `DndDslParseError` (used by the backend).

### Three expression evaluators (intentional parallel implementations)
They share operator logic via `packages/language/src/evaluation/dnd-dsl-expression-ops.ts`
but are otherwise separate:
1. **Backend** `LangiumInterpreterService.evaluateExpression` — walks the **live AST**, has
   side effects (runs functions, fires events), drives `/command/*`.
2. **Canonical** `evaluation/dnd-dsl-value-evaluator.ts` `evaluateSerializedExpression` —
   pure, operates on the **serialized JSON** model.
3. **Frontend** `common/expression-evaluator.ts` — pure, serialized JSON, UI-shaped result.

When changing evaluation semantics, update all three (or the shared ops file).

### State model
- The parsed world is immutable. Runtime mutation lives in a `<world>.state.json`
  **overlay** sidecar. `WorldStateService` re-applies the overlay onto the model after
  every reparse (`rebuildWorldState` / `applyOverlay`).
- `StatePath` (`evaluation/dnd-dsl-state-path.ts`) is a **name-based** path
  (`{kind:'location'|'npc'|'quest'|…, name}`) that survives reparses. `nodeToStatePath` /
  `statePathToNode` convert between an AST/JSON node and a path.
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
- Routes (`App.tsx`): `/`, `/location/:locationName`, `/npcs`, `/script`, `/editor`.
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
