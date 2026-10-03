# Paseo Kanban Agent Instructions

## Project

Build a native Kanban plugin for [Paseo](https://paseo.sh/). Cards are durable work items. Agents are execution attempts linked to cards through run records.

The current public [plugin reference](https://paseo.sh/docs/plugins/reference) and [SDK reference](https://paseo.sh/docs/sdk/reference) are authoritative. Target Paseo `>=0.10.2 <0.11.0` until an explicit compatibility upgrade changes the manifest and tests.

## Version 0.1 contract

- One board per Paseo project on one selected host.
- Fixed columns: Backlog, Todo, In Progress, In Review, Done.
- Manual card creation, editing, filtering, movement, and ordering.
- Explicit workspace selection before starting an agent.
- One card may have multiple runs; each run links one Paseo agent and workspace.
- Agent state is an overlay on card state.
- A finished agent suggests review but never automatically marks the card reviewed or done.
- Schedules, cross-host synchronization, shared multi-user boards, and drag and drop are deferred.

## Architecture

- Register the full-page UI with `addScreen` and the navigation row with `addSidebarHeaderItem`.
- Use the existing Paseo client from `usePaseo()` or contribution callbacks. Never create a second client from plugin code.
- Use the Paseo SDK for normal agent, workspace, provider, project, and configuration operations.
- Use plugin RPCs only for plugin-specific daemon-side behavior.
- Keep board data and display preferences in separate versioned, host-scoped settings documents.
- Treat lifecycle events as live, best-effort signals. Reconcile durable state from the agent directory after startup and reconnect.

## Runtime boundaries

- `index.client.tsx` registers client contributions.
- `index.server.ts` registers settings, RPC handlers, and lifecycle hooks.
- `client/` contains React, React Native, hooks, styles, screens, panels, and callbacks.
- `server/` contains Node APIs, local resources, and daemon handlers.
- `shared/` contains schemas, RPC contracts, migrations, pure operations, and plain values.
- Do not add other code modules at the plugin root.
- Client code must not import `server/`, Node modules, DOM APIs, or private Paseo host modules.
- Server code must not import `client/`, React, React Native, or client SDK entries.
- Shared code must not import client- or server-specific runtime modules, including through types.

## UI

- Use [React Native](https://reactnative.dev/) primitives and `onPress` handlers.
- Use Paseo theme colors for all text, surfaces, controls, borders, and states.
- Support both wide and compact layouts.
- Prefer explicit move controls for the first release. Add drag and drop only after keyboard, mobile, and accessibility behavior is defined.
- Never use HTML elements, CSS strings, `className`, `onClick`, `window`, `document`, `localStorage`, or `navigator` in cross-platform client components.

## Domain and persistence

- Keep `Board`, `Card`, and `Run` as separate records.
- Use stable card IDs and display keys. Never use an agent ID as a card ID.
- Link agents with string labels containing the board, card, and run IDs.
- Keep transcripts, prompts, credentials, secrets, and large agent outputs out of persisted board data.
- Version every settings schema and provide explicit migrations.
- Preserve invalid or unsupported newer data rather than silently resetting it.
- Implement export and import before relying on the plugin for durable work.
- Handle settings revision conflicts by reloading and replaying the user's small operation.

## Agent integration

- Create agents from an explicit user action.
- Persist the returned agent and workspace IDs in a run record.
- Reconcile orphaned runs or unlinked agents by labels after reconnect or plugin reload.
- Present running, permission-required, error, finished, and archived states as badges.
- Do not auto-approve agent permissions.
- Do not infer completion from an idle session alone.

## Schedules

- Do not make schedule integration a dependency of the initial board.
- Model a schedule as a card template and each occurrence as a distinct card and run.
- Before implementing schedules, prove that the supported interface exposes stable schedule, run, and generated agent IDs.
- Do not correlate scheduled runs by title, prompt text, timestamps, or list ordering.
- Prefer a supported Paseo SDK contract. Treat a CLI adapter as a contained compatibility layer with exact argument arrays and no shell.

## Security

- Paseo plugins are trusted and unsandboxed. Minimize server-side filesystem, process, credential, and network access.
- Validate settings and RPC inputs and outputs with shared schemas.
- Do not log card descriptions, prompts, transcripts, credentials, tokens, or secrets.
- Do not execute arbitrary card content as a command.
- Require explicit confirmation for destructive board operations.
- Do not weaken Paseo approval, sandbox, or permission settings.

## Development workflow

- Use the package manager and scripts generated by `paseo plugin init`.
- Keep dependencies conservative and compatible with the host-provided client modules.
- Make the smallest coherent change and keep migrations with schema changes.
- Add focused tests for migrations, card operations, ordering, reconciliation, and conflict handling.
- Do not add tests that merely restate component implementation.
- Run before install or reload:

```bash
npm run typecheck
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

- After installation or changes:

```bash
paseo plugin reload kanban
paseo plugin ls kanban
paseo plugin logs kanban
```

- Verify wide and compact layouts, light and dark themes, RPC errors, reconnect reconciliation, and agent permission/error states.
- Do not restart the Paseo daemon to load plugin source changes.

## Source control

- The default branch is `main` and the remote is `origin`.
- Do not commit, push, publish, tag, or open a pull request unless the user explicitly requests it.
- Never force push, rewrite history, or delete branches without explicit confirmation.
- Never add AI attribution, co-author, generated-by, or similar credit lines.
