import { settingsRpc } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { materializeAgentProfile, type AgentProfile } from "../shared/agentProfiles";
import {
  AGENT_LABELS,
  BOARD_COLUMNS,
  BoardDataSchema,
  type BoardColumn,
  type BoardData,
  type Card,
  type DisplaySettings,
  type Run,
} from "../shared/model";
import {
  applyBoardOperations,
  boardForProject,
  cardsInColumn,
  createId,
  type BoardOperation,
} from "../shared/operations";
import { canContinueAgent } from "../shared/runState";
import { boardDataSettings, displaySettings } from "../shared/settings";
import { BoardColumn as BoardColumnView } from "./BoardColumn";
import {
  AgentLauncherPanel,
  type AgentLauncherState,
  CardDetailsPanel,
  CardEditorPanel,
  type EditorState,
  ImportPanel,
} from "./BoardPanels";
import { errorMessage } from "./errors";
import { ProjectPicker } from "./ProjectPicker";
import { useBoardStyles } from "./useBoardStyles";
import { usePaseoDirectory, type WorkspaceSummary } from "./usePaseoDirectory";

const boardRpc = settingsRpc(boardDataSettings.id);
const displayRpc = settingsRpc(displaySettings.id);
const COLUMN_TONES = {
  backlog: "#64748b",
  todo: "#d97706",
  in_progress: "#16a34a",
  in_review: "#7c3aed",
  done: "#0891b2",
} satisfies Record<BoardColumn, string>;
type NullableString = string | null;

function defaultWorkspaceId(workspaces: readonly WorkspaceSummary[], projectId: string | null): string | null {
  const available = workspaces.filter((workspace) => workspace.projectId === projectId);
  const main = available.find((workspace) =>
    [workspace.title, workspace.name].some((name) => /^main(?: branch)?$/i.test(name?.trim() ?? "")),
  );
  return (main ?? available[0])?.id ?? null;
}

function withLauncherDefaults(
  launcher: AgentLauncherState,
  agentProfiles: readonly AgentProfile[],
  workspaces: readonly WorkspaceSummary[],
  projectId: string | null,
): AgentLauncherState {
  const agentProfileId = agentProfiles.some((profile) => profile.id === launcher.agentProfileId)
    ? launcher.agentProfileId
    : agentProfiles[0]?.id ?? null;
  const workspaceId = launcher.workspaceMode === "existing" &&
      !workspaces.some((workspace) => workspace.projectId === projectId && workspace.id === launcher.workspaceId)
    ? defaultWorkspaceId(workspaces, projectId)
    : launcher.workspaceId;
  return agentProfileId === launcher.agentProfileId && workspaceId === launcher.workspaceId
    ? launcher
    : { ...launcher, agentProfileId, workspaceId };
}

export function BoardSurface({ theme, layout, host, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const boardSettings = useSettings(boardDataSettings);
  const displayState = useSettings(displaySettings);
  const readBoard = useRpc(boardRpc.read);
  const readDisplay = useRpc(displayRpc.read);
  const [selectedProjectId, setSelectedProjectId] = useState<NullableString>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [filter, setFilter] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<NullableString>(null);
  const [runCardId, setRunCardId] = useState<NullableString>(null);
  const [launcher, setLauncher] = useState<AgentLauncherState | null>(null);
  const [startingAgent, setStartingAgent] = useState(false);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = useState<NullableString>(null);
  const [importText, setImportText] = useState<NullableString>(null);
  const [importValidated, setImportValidated] = useState<BoardData | null>(null);
  const cardSaveInFlight = useRef(false);
  const ensuringProject = useRef<NullableString>(null);
  const displayInitialized = useRef(false);
  const reconciling = useRef(false);
  const styles = useBoardStyles(theme, layout.compact);

  const currentBoard =
    boardSettings.status === "ready" && selectedProjectId
      ? boardForProject(boardSettings.values, selectedProjectId)
      : undefined;
  const directory = usePaseoDirectory(selectedProjectId, currentBoard?.id ?? null);

  useEffect(() => {
    if (!launcher || launcher.action !== "start") return;
    if (withLauncherDefaults(launcher, directory.agentProfiles, directory.workspaces, selectedProjectId) === launcher) return;
    setLauncher((current) =>
      current && current.action === "start"
        ? withLauncherDefaults(current, directory.agentProfiles, directory.workspaces, selectedProjectId)
        : current,
    );
  }, [directory.agentProfiles, directory.workspaces, launcher, selectedProjectId]);

  const persistOperations = useCallback(
    async (operations: readonly BoardOperation[]) => {
      if (boardSettings.status !== "ready") throw new Error("Board data is not ready");
      const next = BoardDataSchema.parse(applyBoardOperations(boardSettings.values, operations));
      if (await boardSettings.save(next, boardSettings.revision)) return;
      const fresh = await readBoard({});
      if (fresh.status !== "ready") throw new Error(fresh.error);
      const values = BoardDataSchema.parse(fresh.values);
      const replayed = BoardDataSchema.parse(applyBoardOperations(values, operations));
      if (!(await boardSettings.save(replayed, fresh.revision))) {
        throw new Error("Board changed again while saving. Retry the action.");
      }
    },
    [boardSettings, readBoard],
  );

  const replaceBoardData = useCallback(
    async (values: BoardData) => {
      if (boardSettings.status !== "ready") throw new Error("Board data is not ready");
      if (await boardSettings.save(values, boardSettings.revision)) return;
      const fresh = await readBoard({});
      if (fresh.status !== "ready") throw new Error(fresh.error);
      if (!(await boardSettings.save(values, fresh.revision))) {
        throw new Error("Board changed again while importing. Retry the import.");
      }
    },
    [boardSettings, readBoard],
  );

  const persistDisplay = useCallback(
    async (change: (current: DisplaySettings) => DisplaySettings) => {
      if (displayState.status !== "ready") return;
      const next = displaySettings.schema.parse(change(displayState.values));
      if (await displayState.save(next, displayState.revision)) return;
      const fresh = await readDisplay({});
      if (fresh.status !== "ready") throw new Error(fresh.error);
      const values = displaySettings.schema.parse(fresh.values);
      if (!(await displayState.save(displaySettings.schema.parse(change(values)), fresh.revision))) {
        throw new Error("Display settings changed again while saving.");
      }
    },
    [displayState, readDisplay],
  );

  useEffect(() => {
    if (displayState.status !== "ready" || directory.projects.length === 0) return;
    if (displayInitialized.current) return;
    displayInitialized.current = true;
    const preferred = displayState.values.selectedProjectId;
    const selected = directory.projects.some((project) => project.projectId === preferred)
      ? preferred
      : directory.projects[0]!.projectId;
    if (!selectedProjectId) setSelectedProjectId(selected);
    setFilter((current) => (current ? current : displayState.values.filter));
    if (preferred !== selected) {
      void persistDisplay((values) => ({ ...values, selectedProjectId: selected })).catch((cause) =>
        toast.error(errorMessage(cause)),
      );
    }
  }, [directory.projects, displayState, persistDisplay, selectedProjectId, toast]);

  useEffect(() => {
    if (boardSettings.status !== "ready" || !selectedProjectId || currentBoard) return;
    if (ensuringProject.current === selectedProjectId) return;
    const project = directory.projects.find((candidate) => candidate.projectId === selectedProjectId);
    if (!project) return;
    ensuringProject.current = selectedProjectId;
    void persistOperations([
      {
        type: "ensure-board",
        boardId: createId("board"),
        projectId: project.projectId,
        projectName: project.projectDisplayName,
        now: new Date().toISOString(),
      },
    ])
      .catch((cause) => toast.error(errorMessage(cause)))
      .finally(() => {
        ensuringProject.current = null;
      });
  }, [boardSettings.status, currentBoard, directory.projects, persistOperations, selectedProjectId, toast]);

  useEffect(() => {
    if (boardSettings.status !== "ready" || directory.agents.length === 0) return;
    if (reconciling.current) return;
    const links = directory.agents.flatMap((agent) => {
      const workspaceId = agent.workspaceId;
      if (!workspaceId) return [];
      const workspace = directory.workspaces.find((candidate) => candidate.id === workspaceId);
      return [
        {
          agentId: agent.id,
          workspaceId,
          provider: agent.provider,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          labels: agent.labels,
          workspaceName: workspace?.title ?? workspace?.name ?? null,
        },
      ];
    });
    const needsReconciliation = links.some((link) => {
      const runId = link.labels[AGENT_LABELS.runId];
      const run = boardSettings.values.runs.find(
        (candidate) => candidate.id === runId || candidate.agentId === link.agentId,
      );
      return !run || run.workspaceId !== link.workspaceId || run.agentId !== link.agentId;
    });
    if (!needsReconciliation) return;
    reconciling.current = true;
    void persistOperations([{ type: "reconcile-runs", agents: links }])
      .catch((cause) => toast.error(errorMessage(cause)))
      .finally(() => {
        reconciling.current = false;
      });
  }, [boardSettings, directory.agents, directory.workspaces, persistOperations, toast]);

  const action = useCallback(
    async (operations: readonly BoardOperation[], success?: string) => {
      try {
        await persistOperations(operations);
        if (success) toast.show(success, { variant: "success" });
      } catch (cause) {
        toast.error(errorMessage(cause));
        throw cause;
      }
    },
    [persistOperations, toast],
  );

  if (boardSettings.status === "loading" || displayState.status === "loading") {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>Loading Kanban data…</Text>
      </View>
    );
  }

  if (boardSettings.status === "error" || displayState.status === "error") {
    const error = boardSettings.status === "error" ? boardSettings.error :
      displayState.status === "error" ? displayState.error : "Settings failed to load";
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (boardSettings.status === "invalid" || displayState.status === "invalid") {
    const error = boardSettings.status === "invalid" ? boardSettings.error :
      displayState.status === "invalid" ? displayState.error : "Settings are invalid";
    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>Kanban data needs attention</Text>
        <Text style={styles.error}>{error}</Text>
        <Text style={styles.muted}>The stored document was preserved and was not reset.</Text>
      </View>
    );
  }

  const board = selectedProjectId ? boardForProject(boardSettings.values, selectedProjectId) : undefined;
  const normalizedFilter = filter.trim().toLowerCase();
  const boardCards = boardSettings.values.cards.filter(
    (card) =>
      card.boardId === board?.id &&
      (!normalizedFilter ||
        `${card.key} ${card.title} ${card.description}`.toLowerCase().includes(normalizedFilter)),
  );
  const selectedProject = directory.projects.find(
    (candidate) => candidate.projectId === selectedProjectId,
  );
  const projectWorkspaces = directory.workspaces.filter(
    (workspace) => workspace.projectId === selectedProjectId,
  );
  const linkedAgentIds = new Set(boardSettings.values.runs.map((run) => run.agentId));
  const attachableAgents = directory.agents.filter(
    (agent) =>
      !agent.archivedAt &&
      !linkedAgentIds.has(agent.id) &&
      Boolean(agent.workspaceId) &&
      projectWorkspaces.some((workspace) => workspace.id === agent.workspaceId),
  );
  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setProjectPickerOpen(false);
    setProjectFilter("");
    setEditor(null);
    setSelectedCardId(null);
    setRunCardId(null);
    setLauncher(null);
    void persistDisplay((values) => ({ ...values, selectedProjectId: projectId })).catch((cause) =>
      toast.error(errorMessage(cause)),
    );
  };

  const saveEditor = async () => {
    if (!editor || !board || cardSaveInFlight.current || !editor.title.trim()) return;
    const mode = editor.mode;
    const now = new Date().toISOString();
    const operation: BoardOperation =
      editor.mode === "create"
        ? {
            type: "create-card",
            cardId: createId("card"),
            boardId: board.id,
            title: editor.title,
            description: editor.description,
            column: editor.column,
            now,
          }
        : {
            type: "update-card",
            cardId: editor.cardId!,
            title: editor.title,
            description: editor.description,
            now,
          };
    try {
      cardSaveInFlight.current = true;
      setSavingCard(true);
      await action([operation], mode === "create" ? "Card created" : "Card updated");
      setEditor(null);
    } catch {
      // The editor remains open so the user's input is not lost.
    } finally {
      cardSaveInFlight.current = false;
      setSavingCard(false);
    }
  };

  const moveCard = (card: Card, column: BoardColumn, index: number) => {
    void action([
      { type: "move-card", cardId: card.id, column, index, now: new Date().toISOString() },
    ]).catch(() => undefined);
  };

  const openLauncher = (card: Card) => {
    setEditor(null);
    setSelectedCardId(null);
    setRunCardId(card.id);
    setLauncher(withLauncherDefaults({
      action: "start",
      agentProfileId: null,
      workspaceMode: "existing",
      workspaceId: null,
      workspaceTitle: `${card.key}: ${card.title}`,
      baseRef: "",
      branchName: "",
      attachAgentId: null,
      moveAttachedCardToInProgress: true,
    }, directory.agentProfiles, projectWorkspaces, selectedProjectId));
    void directory.refreshAgentProfiles();
  };

  const closeLauncher = () => {
    setRunCardId(null);
    setLauncher(null);
  };

  const runAgent = async () => {
    if (!board || !runCardId || !launcher) return;
    const card = boardSettings.values.cards.find((candidate) => candidate.id === runCardId);
    if (!card || card.boardId !== board.id) return;
    if (card.column === "backlog" || card.column === "done") {
      closeLauncher();
      toast.error("Move the card to Ready before starting an agent.");
      return;
    }
    setStartingAgent(true);
    const runId = createId("run");
    const now = new Date().toISOString();
    try {
      if (launcher.action === "attach") {
        const agent = directory.agents.find((candidate) => candidate.id === launcher.attachAgentId);
        if (!agent || agent.archivedAt) throw new Error("The selected agent is no longer available.");
        if (!agent.workspaceId) throw new Error("The selected agent has no workspace.");
        if (!projectWorkspaces.some((workspace) => workspace.id === agent.workspaceId)) {
          throw new Error("The selected agent belongs to another project.");
        }
        if (boardSettings.values.runs.some((run) => run.agentId === agent.id)) {
          throw new Error("The selected agent is already attached to a card.");
        }
        const workspace = projectWorkspaces.find((candidate) => candidate.id === agent.workspaceId);
        const operations: BoardOperation[] = [
          {
            type: "add-run",
            run: {
              id: runId,
              cardId: card.id,
              agentId: agent.id,
              workspaceId: agent.workspaceId,
              provider: agent.provider,
              agentProfileId: null,
              agentProfileName: null,
              workspaceName: workspace?.title ?? workspace?.name ?? null,
              branchName: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        ];
        const moveAttachedCard =
          launcher.moveAttachedCardToInProgress &&
          (card.column === "todo" || card.column === "in_review");
        if (moveAttachedCard) {
          operations.push({
            type: "move-card",
            cardId: card.id,
            column: "in_progress",
            index: cardsInColumn(boardSettings.values, board.id, "in_progress").length,
            now,
          });
        }
        await persistOperations(operations);
        toast.show(
          moveAttachedCard ? "Agent attached and card moved to In Progress" : "Agent attached",
          { variant: "success" },
        );
        closeLauncher();
        return;
      }

      const profiles = await directory.refreshAgentProfiles();
      const profile = profiles.find((candidate) => candidate.id === launcher.agentProfileId);
      if (!profile) throw new Error("Select an available agent profile.");

      let resolvedWorkspaceId = launcher.workspaceId;
      let createdWorkspaceName: string | null = null;
      let createdBranchName: string | null = null;
      if (launcher.workspaceMode === "new") {
        const project = directory.projects.find((candidate) => candidate.projectId === selectedProjectId);
        if (!project || project.projectKind !== "git") {
          throw new Error("New worktrees require a Git project.");
        }
        const baseRef = launcher.baseRef.trim();
        const branchName = launcher.branchName.trim();
        const workspace = await paseo.workspaces.create({
          title: launcher.workspaceTitle.trim() || `${card.key}: ${card.title}`,
          source: {
            kind: "worktree",
            projectId: project.projectId,
            cwd: project.projectRootPath,
            action: "branch-off",
            ...(baseRef ? { refName: baseRef } : {}),
            ...(branchName ? { branchName } : {}),
          },
        });
        resolvedWorkspaceId = workspace.id;
        createdWorkspaceName = launcher.workspaceTitle.trim() || `${card.key}: ${card.title}`;
        createdBranchName = branchName || null;
        setLauncher((current) =>
          current
            ? { ...current, workspaceMode: "existing", workspaceId: workspace.id }
            : current,
        );
        directory.refreshWorkspaces();
      }
      if (!resolvedWorkspaceId) throw new Error("Select a workspace.");
      if (
        launcher.workspaceMode === "existing" &&
        !projectWorkspaces.some((workspace) => workspace.id === resolvedWorkspaceId)
      ) {
        throw new Error("The selected workspace is no longer available in this project.");
      }

      const agent = await paseo.workspaces.ref(resolvedWorkspaceId).agents.create({
        config: materializeAgentProfile(profile),
        title: `${card.key}: ${card.title}`,
        labels: {
          [AGENT_LABELS.boardId]: board.id,
          [AGENT_LABELS.cardId]: card.id,
          [AGENT_LABELS.runId]: runId,
          [AGENT_LABELS.agentProfileId]: profile.id,
          [AGENT_LABELS.cardKey]: card.key,
        },
        prompt: [
          `Work on ${card.key}: ${card.title}.`,
          card.description,
          "Report the result and any remaining work when finished.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      const operations: BoardOperation[] = [
        {
          type: "add-run",
          run: {
            id: runId,
            cardId: card.id,
            agentId: agent.id,
            workspaceId: resolvedWorkspaceId,
            provider: profile.provider,
            agentProfileId: profile.id,
            agentProfileName: profile.name,
            workspaceName:
              createdWorkspaceName ??
              projectWorkspaces.find((workspace) => workspace.id === resolvedWorkspaceId)?.title ??
              projectWorkspaces.find((workspace) => workspace.id === resolvedWorkspaceId)?.name ??
              null,
            branchName: createdBranchName,
            createdAt: agent.current()?.createdAt ?? now,
            updatedAt: agent.current()?.updatedAt ?? now,
          },
        },
      ];
      if (card.column === "todo" || card.column === "in_review") {
        operations.push({
          type: "move-card",
          cardId: card.id,
          column: "in_progress",
          index: cardsInColumn(boardSettings.values, board.id, "in_progress").length,
          now,
        });
      }
      await persistOperations(operations);
      toast.show("Agent started", { variant: "success" });
      closeLauncher();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setStartingAgent(false);
    }
  };

  const latestRunForCard = (cardId: string): Run | undefined =>
    boardSettings.values.runs
      .filter((run) => run.cardId === cardId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  const requestChanges = async (card: Card) => {
    const latestRun = latestRunForCard(card.id);
    const agent = latestRun
      ? directory.agents.find((candidate) => candidate.id === latestRun.agentId)
      : undefined;

    if (
      agent &&
      (agent.attentionReason === "permission" ||
        agent.status === "running" ||
        agent.status === "initializing")
    ) {
      navigation?.openAgent({ agentId: agent.id, serverId: host.id });
      toast.show(
        agent.attentionReason === "permission"
          ? "Resolve the pending permission before requesting changes."
          : "The current agent is still active.",
        { variant: "warning" },
      );
      return;
    }

    if (latestRun && canContinueAgent(agent)) {
      try {
        await paseo.agents.ref(latestRun.agentId).send(
          [
            `Please address the requested changes for ${card.key}: ${card.title}.`,
            card.description,
            "Re-check the requirements and report the changes and any remaining work.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        await persistOperations([
          {
            type: "move-card",
            cardId: card.id,
            column: "in_progress",
            index: cardsInColumn(boardSettings.values, card.boardId, "in_progress").length,
            now: new Date().toISOString(),
          },
        ]);
        toast.show("Changes requested from the current agent", { variant: "success" });
      } catch (cause) {
        toast.error(errorMessage(cause));
      }
      return;
    }

    try {
      await action([
        {
          type: "move-card",
          cardId: card.id,
          column: "in_progress",
          index: cardsInColumn(boardSettings.values, card.boardId, "in_progress").length,
          now: new Date().toISOString(),
        },
      ]);
      openLauncher(card);
    } catch {
      // The card stays in review and the launcher stays closed.
    }
  };

  const validateImport = () => {
    try {
      const parsed = BoardDataSchema.parse(JSON.parse(importText ?? ""));
      setImportValidated(parsed);
      toast.show("Backup is valid. Confirm to replace board data.", { variant: "warning" });
    } catch (cause) {
      setImportValidated(null);
      toast.error(errorMessage(cause));
    }
  };

  const confirmImport = async () => {
    if (!importValidated) return;
    try {
      await replaceBoardData(importValidated);
      setImportText(null);
      setImportValidated(null);
      toast.show("Board data imported", { variant: "success" });
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  return (
    <View style={styles.screen}>
      <ProjectPicker
        filter={projectFilter}
        foregroundMuted={theme.colors.foregroundMuted}
        onFilterChange={setProjectFilter}
        onSelect={selectProject}
        onToggle={() => {
          if (projectPickerOpen) setProjectFilter("");
          setProjectPickerOpen((open) => !open);
        }}
        open={projectPickerOpen}
        projects={directory.projects}
        selectedProjectId={selectedProjectId}
        styles={styles}
      />

      <View style={styles.controlBar}>
        <TextInput
          accessibilityLabel="Filter cards"
          placeholder="Filter cards"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={filter}
          onChangeText={setFilter}
          onBlur={() => {
            void persistDisplay((values) => ({ ...values, filter })).catch((cause) =>
              toast.error(errorMessage(cause)),
            );
          }}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!board}
          onPress={() => {
            setSelectedCardId(null);
            closeLauncher();
            setEditor({ mode: "create", cardId: null, title: "", description: "", column: "backlog" });
          }}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={[styles.buttonText, styles.primaryButtonText]}>New card</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void copyText(JSON.stringify(boardSettings.values, null, 2))
              .then(() => toast.show("Board backup copied", { variant: "success" }))
              .catch((cause) => toast.error(errorMessage(cause)));
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Copy backup</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setImportText("");
            setImportValidated(null);
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Import</Text>
        </Pressable>
      </View>

      {directory.error ? <Text style={styles.error}>{directory.error}</Text> : null}
      {directory.projects.length === 0 ? (
        <Text style={styles.warning}>No Paseo projects are available on {host.label}.</Text>
      ) : null}

      {editor ? (
        <CardEditorPanel
          editor={editor}
          onCancel={() => setEditor(null)}
          onChange={setEditor}
          onSave={() => void saveEditor()}
          placeholderColor={theme.colors.foregroundMuted}
          saving={savingCard}
          styles={styles}
        />
      ) : null}

      {selectedCardId ? (() => {
        const card = boardSettings.values.cards.find((candidate) => candidate.id === selectedCardId);
        return card ? (
          <CardDetailsPanel
            agents={directory.agents}
            card={card}
            onClose={() => setSelectedCardId(null)}
            onNewAttempt={(selected) => {
              setSelectedCardId(null);
              openLauncher(selected);
            }}
            onOpenAgent={
              navigation
                ? (agentId) => navigation.openAgent({ agentId, serverId: host.id })
                : undefined
            }
            runs={boardSettings.values.runs}
            statusPalette={{
              accent: theme.colors.accent,
              danger: theme.colors.statusDanger,
              muted: theme.colors.foregroundMuted,
              success: theme.colors.statusSuccess,
              warning: theme.colors.statusWarning,
            }}
            statusTextColor={theme.colors.accentForeground}
            styles={styles}
            workspaces={directory.workspaces}
          />
        ) : null;
      })() : null}

      {runCardId && launcher ? (
        <AgentLauncherPanel
          agentProfiles={directory.agentProfiles}
          attachableAgents={attachableAgents}
          canCreateWorktree={selectedProject?.projectKind === "git"}
          launcher={launcher}
          onCancel={closeLauncher}
          onChange={setLauncher}
          onStart={() => void runAgent()}
          placeholderColor={theme.colors.foregroundMuted}
          profilesSupported={directory.profilesSupported}
          showAttachMoveOption={(() => {
            const card = boardSettings.values.cards.find((candidate) => candidate.id === runCardId);
            return card?.column === "todo" || card?.column === "in_review";
          })()}
          working={startingAgent}
          styles={styles}
          workspaces={projectWorkspaces}
        />
      ) : null}

      {importText !== null ? (
        <ImportPanel
          isValidated={Boolean(importValidated)}
          onCancel={() => {
            setImportText(null);
            setImportValidated(null);
          }}
          onChange={(value) => {
            setImportText(value);
            setImportValidated(null);
          }}
          onConfirm={() => void confirmImport()}
          onValidate={validateImport}
          placeholderColor={theme.colors.foregroundMuted}
          styles={styles}
          value={importText}
        />
      ) : null}

      {board ? (
        <ScrollView
          horizontal={!layout.compact}
          contentContainerStyle={styles.board}
          showsHorizontalScrollIndicator={!layout.compact}
        >
          {BOARD_COLUMNS.map((column) => {
            const allCards = cardsInColumn(boardSettings.values, board.id, column);
            const cards = allCards.filter((card) =>
              boardCards.some((candidate) => candidate.id === card.id),
            );
            return (
              <BoardColumnView
                key={column}
                agents={directory.agents}
                allCards={allCards}
                cards={cards}
                column={column}
                columnTone={COLUMN_TONES[column]}
                confirmDeleteCardId={confirmDeleteCardId}
                onDelete={(cardId) => {
                  if (confirmDeleteCardId !== cardId) {
                    setConfirmDeleteCardId(cardId);
                    return;
                  }
                  void action([{ type: "delete-card", cardId }])
                    .then(() => setConfirmDeleteCardId(null))
                    .catch(() => undefined);
                }}
                onEdit={(card) => {
                  setSelectedCardId(null);
                  closeLauncher();
                  setEditor({
                    mode: "edit",
                    cardId: card.id,
                    title: card.title,
                    description: card.description,
                    column: card.column,
                  });
                }}
                onViewDetails={(card) => {
                  setEditor(null);
                  closeLauncher();
                  setSelectedCardId(card.id);
                }}
                onMove={moveCard}
                onMoveToEnd={(card, column) =>
                  moveCard(
                    card,
                    column,
                    cardsInColumn(boardSettings.values, board.id, column).length,
                  )
                }
                onOpenAgent={
                  navigation
                    ? (agentId) => navigation.openAgent({ agentId, serverId: host.id })
                    : undefined
                }
                onRequestChanges={(card) => void requestChanges(card)}
                onRun={openLauncher}
                runs={boardSettings.values.runs}
                statusPalette={{
                  accent: theme.colors.accent,
                  danger: theme.colors.statusDanger,
                  muted: theme.colors.foregroundMuted,
                  success: theme.colors.statusSuccess,
                  warning: theme.colors.statusWarning,
                }}
                statusTextColor={theme.colors.accentForeground}
                styles={styles}
              />
            );
          })}
        </ScrollView>
      ) : selectedProjectId ? (
        <Text style={styles.muted}>Creating this project's board…</Text>
      ) : null}
    </View>
  );
}
