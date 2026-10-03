# Paseo Kanban

A native Kanban board for [Paseo](https://paseo.sh/) that organizes agent work without treating an agent session as the work item itself.

> Status: version 0.1 is implemented for local use with Paseo 0.10.2.

## Goals

- Provide one Kanban board per Paseo project.
- Keep cards stable across retries, follow-ups, agent archival, and plugin reloads.
- Link each execution attempt to its Paseo agent and workspace.
- Surface running, blocked, failed, finished, and archived execution states on cards.
- Open the latest linked agent from a card.
- Work in wide, compact, light, and dark Paseo layouts.

## Domain model

```text
Board
  └─ Card KAN-42
       ├─ Run 1 → agentId A
       └─ Run 2 → agentId B

Schedule template
  └─ occurrence → Card → Run → agentId
```

A card owns workflow state. A run owns execution state. Completing an agent turn can suggest review, but it does not automatically move a card to In Review or Done.

## Initial scope

| Concern | Version 0.1 |
| --- | --- |
| Deployment | One Paseo host |
| Organization | One board per Paseo project |
| Columns | Backlog, Ready, In Progress, In Review, Done |
| Execution | User starts an agent from a card |
| Workspace | User selects an existing workspace |
| Agent updates | Live status badges with reconnect reconciliation |
| Card movement | Explicit controls with accessibility labels |
| Agent launch | Ready, In Progress, and In Review cards; Backlog and Done move to Ready first |
| Persistence | Paseo host-scoped settings documents |
| Deferred | Schedules, cross-host sync, collaboration, drag and drop |

## Architecture

| Layer | Responsibility |
| --- | --- |
| Client entry | Register the board surface, sidebar row, and Command Center entry |
| Client UI | Render the board using [React Native](https://reactnative.dev/) primitives and Paseo theme tokens |
| Shared | Define schemas, RPC contracts, domain values, migrations, and pure card operations |
| Server entry | Register settings and any daemon-side handlers or lifecycle observers |
| Persistence | Store board data and display preferences in separate versioned settings documents |
| Paseo integration | Create and observe agents through the existing Paseo SDK connection |

The initial compatibility target is Paseo `>=0.10.2 <0.11.0`. Paseo 0.10.2 exposes `addSurface` and `addSidebarItem`; later public documentation uses renamed screen APIs. The implementation follows the installed 0.10.2 SDK contract.

## Planned workflow

1. Create or move a card into Ready when it is actionable.
2. Select a workspace and start an agent from the card.
3. Link the returned agent and workspace IDs to a new run.
4. Move the card to In Progress after agent creation succeeds.
5. Overlay agent runtime state without replacing the card's workflow state.
6. Suggest review when a run finishes; leave the actual transition to the user.
7. Reconcile missing links from agent labels after reconnect or plugin reload.

## Included in 0.1

- Versioned board and display settings.
- Card creation, editing, filtering, movement, ordering, and guarded deletion.
- Wide and compact React Native layouts using Paseo theme tokens.
- JSON backup copy and validated, confirmed import.
- Explicit workspace and provider/model selection before agent creation.
- Durable run records, latest-agent status and navigation, and label-based reconciliation.
- Conflict retry for small persisted operations.
- Sidebar and Command Center navigation.

## Deferred

- Agent workspace panel, composer pill, and card attachment source.
- Drag and drop, after keyboard, mobile, and accessibility behavior is defined.
- Cross-host synchronization and shared multi-user boards.
- **Schedules**
  - Treat schedules as card templates.
  - Require stable schedule-run-to-agent correlation before implementation.
  - Never correlate runs by title, prompt text, timestamps, or list ordering.

## Development

The project uses [npm](https://docs.npmjs.com/) and the SDK version bundled with Paseo 0.10.2. The host provides the client and protocol packages at runtime; the local declarations under `types/` mirror the small part of those unavailable peer packages used for typechecking.

Install dependencies and validate:

```bash
npm install --legacy-peer-deps
npm run check
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

Install into the local Paseo daemon:

```bash
paseo plugin install /absolute/path/to/paseo-kanban
paseo plugin ls kanban
paseo plugin logs kanban
```

Plugin source changes are loaded with `paseo plugin reload kanban`. The daemon should not be restarted for normal plugin development.

## Security and data handling

Paseo plugins are trusted, unsandboxed code. Server code runs with the daemon user's access to local files, processes, credentials, and network services.

- Validate every persisted document and RPC payload.
- Keep prompts, transcripts, credentials, and secrets out of board state and logs.
- Use the Paseo SDK for normal agent and workspace operations.
- Avoid shell execution in the initial implementation.
- Require an explicit user action for destructive board operations.
- Export board state before plugin removal because removing an installation deletes its settings.
