# Paseo Kanban

A native Kanban board for [Paseo](https://paseo.sh/) that organizes agent work without treating an agent session as the work item itself.

> Status: version 0.1 is implemented for local use with Paseo 0.10.2.

## Goals

- Provide one Kanban board per Paseo project.
- Keep cards stable across retries, follow-ups, agent archival, and plugin reloads.
- Link each execution attempt to its Paseo agent and workspace.
- Surface running, blocked, failed, finished, and archived execution states on cards.
- Inspect every linked run and open any linked agent from a card.
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
| Execution | User starts a profiled agent or attaches an existing unlinked project agent |
| Workspace | User selects an existing workspace or creates a Git worktree with optional base ref and branch name |
| Agent updates | Live status badges, complete run history, and reconnect reconciliation |
| Card movement | Drag and drop on wide layouts, with explicit accessible controls retained in card details |
| Agent launch | Ready, In Progress, and In Review cards; Backlog and Done move to Ready first |
| Persistence | Paseo host-scoped settings documents |
| Deferred | Schedules, cross-host sync, collaboration |

## Architecture

| Layer | Responsibility |
| --- | --- |
| Client entry | Register the board surface, agent panel, composer pill, attachment source, sidebar row, and Command Center entries |
| Client UI | Render the board using [React Native](https://reactnative.dev/) primitives and Paseo theme tokens |
| Shared | Define schemas, RPC contracts, domain values, migrations, and pure card operations |
| Server entry | Register settings and any daemon-side handlers or lifecycle observers |
| Persistence | Store board data and display preferences in separate versioned settings documents |
| Paseo integration | Create and observe agents through the existing Paseo SDK connection |

The compatibility target is Paseo `>=0.10.2`. Paseo 0.10.2 exposes `addSurface` and `addSidebarItem`; later public documentation uses renamed screen APIs. The implementation follows the installed 0.10.2 SDK contract and retains those APIs for backward compatibility.

## Planned workflow

1. Create or move a card into Ready when it is actionable.
2. Select a configured agent profile and an existing workspace, or create a Git worktree with an optional base ref and branch name.
3. Start a new agent, or attach an existing unlinked agent from the selected project, and link its agent and workspace IDs to a new run.
4. Move the card to In Progress after agent creation succeeds.
5. Overlay agent runtime state without replacing the card's workflow state.
6. Inspect all attempts from the card or the linked agent workspace panel.
7. Continue an eligible idle agent when requesting changes, or create a distinct attempt with the prior profile and workspace preselected.
8. Suggest review when a run finishes; leave the actual transition to the user.
9. Reconcile missing links from agent labels after reconnect or plugin reload.

## Included in 0.1

- Versioned board and display settings.
- Scan-first card summaries with wide-layout drag and drop; editing, explicit movement, ordering, agent actions, and guarded deletion remain available in card details.
- Wide and compact React Native layouts using Paseo theme tokens.
- JSON backup copy and validated, confirmed import.
- Configured Paseo agent profiles instead of separate provider and model controls.
- Explicit existing-workspace selection or new Git worktree creation, including optional workspace title, base ref, and branch name.
- Existing unlinked project agents can be attached to a card without replacing their agent or workspace identity.
- Durable run records with profile, workspace, branch, timestamps, live status, navigation, and label-based reconciliation.
- Column-aware actions: Start agent in Ready; Open agent and New attempt in In Progress; Request changes and Mark Done in In Review.
- Agent workspace panel with linked-card context, run history, and explicit review actions.
- Composer pills that open the linked card panel and a searchable card attachment source.
- Conflict retry for small persisted operations.
- Sidebar and Command Center navigation.

## Deferred

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
