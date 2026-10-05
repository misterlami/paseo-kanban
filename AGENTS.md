# Paseo Kanban Agent Instructions

## Project

Build a native Kanban plugin for [Paseo](https://paseo.sh/). Cards are durable work items. Agents are execution attempts linked to cards through run records.

The current public [plugin reference](https://paseo.sh/docs/plugins/reference) and [SDK reference](https://paseo.sh/docs/sdk/reference) are authoritative for current releases. Target Paseo `>=0.10.2`. The installed 0.10.2 SDK types remain authoritative for the legacy surface APIs used by this plugin where later public documentation differs.

## Version 0.2 contract

- One board per Paseo project on one selected host.
- Fixed columns: Backlog, Ready, In Progress, In Review, Done.
- Manual card creation, editing, filtering, movement, and ordering, with drag and drop on wide layouts.
- Backlog and Done cards must move to Ready before starting an agent.
- Manual starts require an explicit existing workspace or new Git worktree configuration.
- “Dispatch next” selects the next eligible Ready card in the current project and opens the launcher with a new worktree preselected.
- The optional daily dispatcher selects one eligible Ready card across Git projects on the current host, creates a worktree, starts an agent, and moves the card to In Progress.
- Daily automation is disabled by default and runs only while a Paseo app is connected to the host. It is not a daemon-native Paseo schedule.
- One card may have multiple runs; each run links one Paseo agent and workspace.
- Agent state is an overlay on card state.
- A finished agent suggests review but never automatically marks the card reviewed or done.
- The all-project view aggregates existing boards on the current host without duplicating card storage.
- Daemon-native scheduling, cross-host synchronization, shared multi-user boards, and schedule-generated card templates are deferred.

## Architecture

- Register the full-page UI with `addSurface` and the navigation row with `addSidebarItem`, as exposed by Paseo 0.10.2.
- Use the existing Paseo client from `usePaseo()` or contribution callbacks. Never create a second client from plugin code.
- Use the Paseo SDK for normal agent, workspace, provider, project, and configuration operations.
- Use plugin RPCs only for plugin-specific daemon-side behavior.
- Keep board data, display preferences, and automation configuration in separate versioned, host-scoped settings documents.
- Treat agent subscriptions as live, best-effort signals. Reconcile durable run state from the agent directory after startup and reconnect.
- Run the daily dispatcher from the long-lived client contribution until the supported SDK provides daemon schedule callbacks and daemon-side settings writes.

## Runtime boundaries

- `index.client.tsx` registers client contributions.
- `index.server.ts` registers settings, RPC handlers, and any server lifecycle hooks.
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
- Treat drag and drop as a wide-layout enhancement. Preserve explicit move controls for compact layouts, keyboard use, accessibility, and recovery.
- Keep the all-project view read-only and scoped to the selected host. Provide text, project, column, and agent-state filters, and navigate edits through the owning project board.
- Never use HTML elements, CSS strings, `className`, `onClick`, `window`, `document`, `localStorage`, or `navigator` in cross-platform client components.

## Domain and persistence

- Keep `Board`, `Card`, and `Run` as separate records.
- Use stable card IDs and display keys. Never use an agent ID as a card ID.
- Link agents with string labels containing the board, card, and run IDs.
- Keep transcripts, prompts, credentials, secrets, and large agent outputs out of persisted board data.
- Version every settings schema and provide explicit migrations.
- Preserve invalid or unsupported newer data rather than silently resetting it.
- Implement export and import before relying on the plugin for durable work.
- Guard settings writes with revisions. On conflict, reload and replay the user's small operation. Keep full-document import behind explicit validation and confirmation.
- Store dispatch claims in board data. Claims must expire, prevent duplicate dispatch, and block conflicting card movement or deletion while active.
- Use an atomic per-local-date lease for daily dispatch so connected clients cannot run the same daily invocation twice.
- Persist the scheduled local date on the run and agent labels so reconciliation can suppress duplicate occurrences after interrupted writes.

## Agent integration

- Create agents only from an explicit manual action or an enabled daily dispatcher invocation.
- Persist the returned agent and workspace IDs in a run record.
- Reconcile orphaned runs or unlinked agents by labels after reconnect or plugin reload.
- Retry full-directory reconciliation periodically so transient startup and reconnect failures do not require opening the board.
- Recover interrupted dispatch persistence from board, card, and run labels, clear the matching claim, and move a recovered Ready card to In Progress.
- Present Initializing, Running, Idle, Needs input, Failed, Needs review, Closed, Archived, and Unknown states as badges.
- Prefer the selected configured agent profile, then the first configured profile, then the first available provider's default or selectable model.
- Do not auto-approve agent permissions.
- Do not infer completion from an idle session alone.

## Dispatch and automation

- Claim a card with the current board revision before creating a worktree or agent. Release the claim if creation fails before an agent exists.
- Apply the same duplicate-dispatch protection to manual starts, agent attachment, “Dispatch next,” and daily automation.
- Daily automation processes at most one eligible Ready card per invocation and respects the configured active Kanban-agent concurrency cap.
- Select daily work deterministically by project name, card position, creation time, and card key. Skip active, claimed, externally linked, non-Ready, and non-Git work.
- Prefer a configured profile. If none exists, use the first available provider's default or first selectable model. Fail cleanly and release any pre-agent claim when no execution configuration is available.
- Use `origin/main` as the default automation base ref and generate a unique `codex/` branch name from the card and claim IDs.
- Keep automation disabled by default. Persist its local time, timezone, optional profile, base ref, concurrency cap, lease, and last outcome separately from board data.
- Do not describe the client timer as a native Paseo schedule. It requires a connected Paseo app and may run later the same local day when a client reconnects after the configured time.
- Before replacing it with daemon-native scheduling, require stable callbacks plus daemon-side settings reads and revision-guarded writes.
- If schedule templates are added later, model each occurrence as a distinct card and run. Never correlate runs by title, prompt text, timestamps, or list ordering.

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
npm run check
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

- After installation or changes:

```bash
paseo plugin reload kanban
paseo plugin ls kanban
paseo plugin logs kanban
```

- Verify wide and compact layouts, light and dark themes, all-project filters, manual and daily dispatch, RPC errors, revision conflicts, reconnect reconciliation, interrupted-dispatch recovery, and agent permission/error states.
- Do not restart the Paseo daemon to load plugin source changes.

## Source control

- The default branch is `main` and the remote is `origin`.
- Do not commit, push, publish, tag, or open a pull request unless the user explicitly requests it.
- Never force push, rewrite history, or delete branches without explicit confirmation.
- Never add AI attribution, co-author, generated-by, or similar credit lines.
