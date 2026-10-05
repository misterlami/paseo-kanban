import { settingsRpc } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { AgentProfile } from "../shared/agentProfiles";
import { agentPrompt } from "../shared/automation";
import {
  AGENT_LABELS,
  AutomationSettingsSchema,
  BOARD_COLUMNS,
  BoardDataSchema,
  type AutomationSettings,
  type BoardColumn,
  type BoardData,
  type Card,
  type DisplaySettings,
  type Run,
} from "../shared/model";
import {
  boardForProject,
  cardsInColumn,
  createId,
  nextReadyCard,
  persistedIndexForVisibleDrop,
  type BoardOperation,
} from "../shared/operations";
import { persistBoardOperations } from "../shared/persistence";
import { canContinueAgent, isActiveAgent } from "../shared/runState";
import { automationSettings, boardDataSettings, displaySettings } from "../shared/settings";
import { AllProjectsPanel } from "./AllProjectsPanel";
import { resolveAgentExecution } from "./agentExecution";
import { AutomationPanel } from "./AutomationPanel";
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
const automationRpc = settingsRpc(automationSettings.id);
const CLAIM_LIFETIME_MS = 30 * 60 * 1_000;
type NullableString = string | null;
interface LayoutRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
interface DragTarget {
  column: BoardColumn;
  index: number;
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
  const workspaceId =
    launcher.workspaceMode === "existing" &&
    !workspaces.some(
      (workspace) => workspace.projectId === projectId && workspace.id === launcher.workspaceId,
    )
      ? null
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
  const automationState = useSettings(automationSettings);
  const readBoard = useRpc(boardRpc.read);
  const writeBoard = useRpc(boardRpc.write);
  const readDisplay = useRpc(displayRpc.read);
  const readAutomation = useRpc(automationRpc.read);
  const [view, setView] = useState<"project" | "all">("project");
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
  const [automationDraft, setAutomationDraft] = useState<AutomationSettings | null>(null);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const cardSaveInFlight = useRef(false);
  const ensuringProject = useRef<NullableString>(null);
  const displayInitializedHostId = useRef<string | null>(null);
  const reconciling = useRef(false);
  const boardScroll = useRef<ScrollView | null>(null);
  const boardViewportView = useRef<View | null>(null);
  const boardViewport = useRef<LayoutRect | null>(null);
  const boardScrollX = useRef(0);
  const boardContentWidth = useRef(0);
  const columnLayouts = useRef(new Map<BoardColumn, LayoutRect>());
  const cardLayouts = useRef(new Map<string, LayoutRect>());
  const dragTargetRef = useRef<DragTarget | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<NullableString>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const styles = useBoardStyles(theme, layout.compact);
  const columnTones = {
    backlog: theme.colors.foregroundMuted,
    todo: theme.colors.statusWarning,
    in_progress: theme.colors.accent,
    in_review: theme.colors.statusWarning,
    done: theme.colors.statusSuccess,
  } satisfies Record<BoardColumn, string>;

  const currentBoard =
    boardSettings.status === "ready" && selectedProjectId
      ? boardForProject(boardSettings.values, selectedProjectId)
      : undefined;
  const directory = usePaseoDirectory(
    view === "all" ? null : selectedProjectId,
    view === "all" ? null : currentBoard?.id ?? null,
    view === "all",
    host.id,
  );

  useEffect(() => {
    if (!layout.compact) return;
    setDraggingCardId(null);
    dragTargetRef.current = null;
    setDragTarget(null);
  }, [layout.compact]);

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
    (operations: readonly BoardOperation[]) =>
      persistBoardOperations(
        {
          read: () => readBoard({}),
          write: (revision, values) => writeBoard({ revision, values }),
        },
        operations,
      ),
    [readBoard, writeBoard],
  );

  const replaceBoardData = useCallback(
    async (values: BoardData) => {
      if (boardSettings.status !== "ready") throw new Error("Board data is not ready");
      if (await boardSettings.save(values, boardSettings.revision)) return;
      throw new Error("Board changed while the import was pending. Validate the backup again.");
    },
    [boardSettings],
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

  const persistAutomation = useCallback(
    async (values: AutomationSettings) => {
      if (automationState.status !== "ready") throw new Error("Automation settings are not ready");
      const next = AutomationSettingsSchema.parse(values);
      if (await automationState.save(next, automationState.revision)) return;
      const fresh = await readAutomation({});
      if (fresh.status !== "ready") throw new Error(fresh.error);
      const current = AutomationSettingsSchema.parse(fresh.values);
      const replayed = AutomationSettingsSchema.parse({
        ...current,
        enabled: next.enabled,
        dailyTime: next.dailyTime,
        timezone: next.timezone,
        agentProfileId: next.agentProfileId,
        baseRef: next.baseRef,
        maxConcurrent: next.maxConcurrent,
      });
      if (!(await automationState.save(replayed, fresh.revision))) {
        throw new Error("Automation settings changed again while saving.");
      }
    },
    [automationState, readAutomation],
  );

  useEffect(() => {
    if (
      displayState.status !== "ready" ||
      directory.projects.length === 0 ||
      directory.loadedHostId !== host.id
    ) return;
    if (displayInitializedHostId.current === host.id) return;
    displayInitializedHostId.current = host.id;
    const preferred = displayState.values.selectedProjectId;
    const selected = directory.projects.some((project) => project.projectId === preferred)
      ? preferred
      : directory.projects[0]!.projectId;
    setSelectedProjectId(selected);
    setFilter(displayState.values.filter);
    setView(displayState.values.view);
    if (preferred !== selected) {
      void persistDisplay((values) => ({ ...values, selectedProjectId: selected })).catch((cause) =>
        toast.error(errorMessage(cause)),
      );
    }
  }, [directory.loadedHostId, directory.projects, displayState, host.id, persistDisplay, toast]);

  useEffect(() => {
    if (view === "all" || boardSettings.status !== "ready" || !selectedProjectId || currentBoard) return;
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
  }, [boardSettings.status, currentBoard, directory.projects, persistOperations, selectedProjectId, toast, view]);

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

  if (
    boardSettings.status === "loading" ||
    displayState.status === "loading" ||
    automationState.status === "loading"
  ) {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>Loading Kanban data…</Text>
      </View>
    );
  }

  if (
    boardSettings.status === "error" ||
    displayState.status === "error" ||
    automationState.status === "error"
  ) {
    const error = boardSettings.status === "error" ? boardSettings.error :
      displayState.status === "error" ? displayState.error :
      automationState.status === "error" ? automationState.error : "Settings failed to load";
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (
    boardSettings.status === "invalid" ||
    displayState.status === "invalid" ||
    automationState.status === "invalid"
  ) {
    const error = boardSettings.status === "invalid" ? boardSettings.error :
      displayState.status === "invalid" ? displayState.error :
      automationState.status === "invalid" ? automationState.error : "Settings are invalid";
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
  const externallyLinkedCardIds = new Set(
    directory.agents.flatMap((agent) => {
      const cardId = agent.labels[AGENT_LABELS.cardId];
      return cardId && !linkedAgentIds.has(agent.id) ? [cardId] : [];
    }),
  );
  const attachableAgents = directory.agents.filter(
    (agent) =>
      !agent.archivedAt &&
      !linkedAgentIds.has(agent.id) &&
      !agent.labels[AGENT_LABELS.cardId] &&
      Boolean(agent.workspaceId) &&
      projectWorkspaces.some((workspace) => workspace.id === agent.workspaceId),
  );
  const selectProject = (projectId: string) => {
    setView("project");
    setSelectedProjectId(projectId);
    setProjectPickerOpen(false);
    setProjectFilter("");
    setEditor(null);
    setSelectedCardId(null);
    setRunCardId(null);
    setLauncher(null);
    void persistDisplay((values) => ({ ...values, selectedProjectId: projectId, view: "project" })).catch((cause) =>
      toast.error(errorMessage(cause)),
    );
  };

  const selectAllProjects = () => {
    setView("all");
    setProjectPickerOpen(false);
    setProjectFilter("");
    setEditor(null);
    setSelectedCardId(null);
    closeLauncher();
    void persistDisplay((values) => ({ ...values, view: "all" })).catch((cause) =>
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

  const setCurrentDragTarget = (target: DragTarget | null) => {
    dragTargetRef.current = target;
    setDragTarget((current) =>
      current?.column === target?.column && current?.index === target?.index ? current : target,
    );
  };

  const measureBoardViewport = () => {
    boardViewportView.current?.measureInWindow((x, y, width, height) => {
      boardViewport.current = { x, y, width, height };
    });
  };

  const updateDragTarget = (card: Card, pageX: number, pageY: number): DragTarget | null => {
    if (!board || layout.compact || !boardViewport.current) return null;

    const viewport = boardViewport.current;
    if (
      pageX < viewport.x - 24 ||
      pageX > viewport.x + viewport.width + 24 ||
      pageY < viewport.y ||
      pageY > viewport.y + viewport.height
    ) {
      setCurrentDragTarget(null);
      return null;
    }
    const edgeSize = 56;
    const maximumScroll = Math.max(0, boardContentWidth.current - viewport.width);
    let nextScrollX = boardScrollX.current;
    if (pageX < viewport.x + edgeSize) nextScrollX = Math.max(0, nextScrollX - 18);
    else if (pageX > viewport.x + viewport.width - edgeSize) {
      nextScrollX = Math.min(maximumScroll, nextScrollX + 18);
    }
    if (nextScrollX !== boardScrollX.current) {
      boardScrollX.current = nextScrollX;
      boardScroll.current?.scrollTo({ x: nextScrollX, animated: false });
    }

    const contentX = pageX - viewport.x + nextScrollX;
    const contentY = pageY - viewport.y;
    const availableColumns = BOARD_COLUMNS.flatMap((column) => {
      const rect = columnLayouts.current.get(column);
      return rect ? [{ column, rect }] : [];
    });
    if (availableColumns.length === 0) return null;
    const destination = availableColumns.reduce((closest, candidate) => {
      const distance = Math.abs(contentX - (candidate.rect.x + candidate.rect.width / 2));
      const closestDistance = Math.abs(contentX - (closest.rect.x + closest.rect.width / 2));
      return distance < closestDistance ? candidate : closest;
    });
    const visibleCards = cardsInColumn(boardSettings.values, board.id, destination.column)
      .filter((candidate) => candidate.id !== card.id)
      .filter((candidate) => boardCards.some((visible) => visible.id === candidate.id));
    const localY = contentY - destination.rect.y;
    const index = visibleCards.findIndex((candidate) => {
      const rect = cardLayouts.current.get(candidate.id);
      return rect ? localY < rect.y + rect.height / 2 : false;
    });
    const target = { column: destination.column, index: index < 0 ? visibleCards.length : index };
    setCurrentDragTarget(target);
    return target;
  };

  const finishDrag = (card: Card, pageX: number, pageY: number) => {
    const target = updateDragTarget(card, pageX, pageY) ?? dragTargetRef.current;
    setDraggingCardId(null);
    setCurrentDragTarget(null);
    if (!target || !board) return;

    const allDestinationCards = cardsInColumn(boardSettings.values, board.id, target.column)
      .filter((candidate) => candidate.id !== card.id);
    const visibleDestinationCards = allDestinationCards.filter((candidate) =>
      boardCards.some((visible) => visible.id === candidate.id),
    );
    const persistedIndex = persistedIndexForVisibleDrop(
      allDestinationCards,
      visibleDestinationCards,
      target.index,
    );
    const normalizedCurrentIndex = cardsInColumn(boardSettings.values, board.id, card.column)
      .findIndex((candidate) => candidate.id === card.id);
    if (target.column === card.column && persistedIndex === normalizedCurrentIndex) return;
    moveCard(card, target.column, persistedIndex);
  };

  const cancelDrag = () => {
    setDraggingCardId(null);
    setCurrentDragTarget(null);
  };

  const deleteCard = (cardId: string) => {
    if (confirmDeleteCardId !== cardId) {
      setConfirmDeleteCardId(cardId);
      return;
    }
    void action([{ type: "delete-card", cardId, now: new Date().toISOString() }])
      .then(() => {
        setConfirmDeleteCardId(null);
        setSelectedCardId((selected) => selected === cardId ? null : selected);
      })
      .catch(() => undefined);
  };

  const openLauncher = (card: Card, preferNewWorktree = false) => {
    setEditor(null);
    setSelectedCardId(null);
    setRunCardId(card.id);
    setLauncher(withLauncherDefaults({
      action: "start",
      agentProfileId: null,
      workspaceMode: preferNewWorktree ? "new" : "existing",
      workspaceId: null,
      workspaceTitle: `${card.key}: ${card.title}`,
      baseRef: preferNewWorktree ? "origin/main" : "",
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

  const openNextReadyCard = () => {
    if (!board) return;
    const card = nextReadyCard(boardSettings.values, {
      activeAgentIds: new Set(directory.agents.filter(isActiveAgent).map((agent) => agent.id)),
      eligibleBoardIds: new Set([board.id]),
      externallyLinkedCardIds,
      now: new Date().toISOString(),
    });
    if (!card) {
      toast.show("No eligible Ready card is available in this project.", { variant: "warning" });
      return;
    }
    openLauncher(card, true);
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
    let agentCreated = false;
    try {
      if (
        boardSettings.values.runs
          .filter((run) => run.cardId === card.id)
          .some((run) => isActiveAgent(directory.agents.find((agent) => agent.id === run.agentId)))
      ) {
        throw new Error("This card already has an active agent.");
      }
      if (externallyLinkedCardIds.has(card.id)) {
        throw new Error("This card has an agent link pending reconciliation.");
      }
      await persistOperations([
        {
          type: "claim-card",
          claimId: runId,
          cardId: card.id,
          source: "manual",
          now,
          expiresAt: new Date(Date.parse(now) + CLAIM_LIFETIME_MS).toISOString(),
        },
      ]);
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
        const run: Run = {
          id: runId,
          cardId: card.id,
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          provider: agent.provider,
          agentProfileId: null,
          agentProfileName: null,
          workspaceName: workspace?.title ?? workspace?.name ?? null,
          branchName: null,
          scheduledLocalDate: null,
          createdAt: now,
          updatedAt: now,
        };
        const moveAttachedCard =
          launcher.moveAttachedCardToInProgress &&
          (card.column === "todo" || card.column === "in_review");
        await persistOperations([
          {
            type: "complete-dispatch",
            claimId: runId,
            run,
            moveToInProgress: moveAttachedCard,
            now,
          },
        ]);
        toast.show(
          moveAttachedCard ? "Agent attached and card moved to In Progress" : "Agent attached",
          { variant: "success" },
        );
        closeLauncher();
        return;
      }

      const profiles = await directory.refreshAgentProfiles();
      const execution = await resolveAgentExecution(paseo, profiles, launcher.agentProfileId);

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
        config: execution.config,
        title: `${card.key}: ${card.title}`,
        labels: {
          [AGENT_LABELS.boardId]: board.id,
          [AGENT_LABELS.cardId]: card.id,
          [AGENT_LABELS.runId]: runId,
          [AGENT_LABELS.cardKey]: card.key,
          ...(execution.profileId ? { [AGENT_LABELS.agentProfileId]: execution.profileId } : {}),
        },
        prompt: agentPrompt(card),
      });
      agentCreated = true;
      const run: Run = {
        id: runId,
        cardId: card.id,
        agentId: agent.id,
        workspaceId: resolvedWorkspaceId,
        provider: execution.config.provider,
        agentProfileId: execution.profileId,
        agentProfileName: execution.profileName,
        workspaceName:
          createdWorkspaceName ??
          projectWorkspaces.find((workspace) => workspace.id === resolvedWorkspaceId)?.title ??
          projectWorkspaces.find((workspace) => workspace.id === resolvedWorkspaceId)?.name ??
          null,
        branchName: createdBranchName,
        scheduledLocalDate: null,
        createdAt: agent.current()?.createdAt ?? now,
        updatedAt: agent.current()?.updatedAt ?? now,
      };
      await persistOperations([
        {
          type: "complete-dispatch",
          claimId: runId,
          run,
          moveToInProgress: card.column === "todo" || card.column === "in_review",
          now,
        },
      ]);
      toast.show("Agent started", { variant: "success" });
      closeLauncher();
    } catch (cause) {
      if (!agentCreated) {
        await persistOperations([{ type: "release-claim", claimId: runId }]).catch(() => undefined);
      }
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
      setImportValidated(null);
      toast.error(errorMessage(cause));
    }
  };

  const saveAutomation = async () => {
    if (!automationDraft || savingAutomation) return;
    try {
      setSavingAutomation(true);
      const validated = AutomationSettingsSchema.parse({
        ...automationDraft,
        baseRef: automationDraft.baseRef.trim(),
      });
      await persistAutomation(validated);
      setAutomationDraft(null);
      toast.show("Daily dispatcher settings saved", { variant: "success" });
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSavingAutomation(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ProjectPicker
        allProjects={view === "all"}
        filter={projectFilter}
        foregroundMuted={theme.colors.foregroundMuted}
        onFilterChange={setProjectFilter}
        onSelect={selectProject}
        onSelectAll={selectAllProjects}
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
          disabled={!board || view === "all"}
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
          disabled={!board || view === "all"}
          onPress={openNextReadyCard}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Dispatch next</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setAutomationDraft({
              ...automationState.values,
              timezone:
                automationState.values.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone ??
                "UTC",
            });
            setEditor(null);
            setSelectedCardId(null);
            closeLauncher();
          }}
          style={[styles.button, automationState.values.enabled && styles.selectedChip]}
        >
          <Text style={[styles.buttonText, automationState.values.enabled && styles.selectedChipText]}>
            Daily dispatch {automationState.values.enabled ? "on" : "off"}
          </Text>
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

      {automationDraft ? (
        <AutomationPanel
          agentProfiles={directory.agentProfiles}
          draft={automationDraft}
          onCancel={() => setAutomationDraft(null)}
          onChange={setAutomationDraft}
          onSave={() => void saveAutomation()}
          placeholderColor={theme.colors.foregroundMuted}
          saving={savingAutomation}
          styles={styles}
        />
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
            allCards={cardsInColumn(boardSettings.values, card.boardId, card.column)}
            card={card}
            confirmDeleteCardId={confirmDeleteCardId}
            onClose={() => {
              setConfirmDeleteCardId(null);
              setSelectedCardId(null);
            }}
            onDelete={deleteCard}
            onEdit={(selected) => {
              setConfirmDeleteCardId(null);
              setSelectedCardId(null);
              closeLauncher();
              setEditor({
                mode: "edit",
                cardId: selected.id,
                title: selected.title,
                description: selected.description,
                column: selected.column,
              });
            }}
            onMove={moveCard}
            onMoveToEnd={(selected, column) =>
              moveCard(
                selected,
                column,
                cardsInColumn(boardSettings.values, selected.boardId, column).length,
              )
            }
            onNewAttempt={(selected) => {
              setSelectedCardId(null);
              openLauncher(selected);
            }}
            onOpenAgent={
              navigation
                ? (agentId) => navigation.openAgent({ agentId, serverId: host.id })
                : undefined
            }
            onRequestChanges={(selected) => void requestChanges(selected)}
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
          profileFallbackColor={theme.colors.foregroundMuted}
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

      {view === "all" ? (
        <AllProjectsPanel
          agents={directory.agents}
          data={boardSettings.values}
          filter={filter}
          onOpenProject={(projectId, cardId) => {
            selectProject(projectId);
            setSelectedCardId(cardId);
          }}
          projects={directory.projects}
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
      ) : board ? (
        <View ref={boardViewportView} onLayout={measureBoardViewport} style={styles.boardViewport}>
          <ScrollView
            ref={boardScroll}
            horizontal={!layout.compact}
            contentContainerStyle={styles.board}
            onContentSizeChange={(width) => {
              boardContentWidth.current = width;
            }}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
              boardScrollX.current = event.nativeEvent.contentOffset.x;
            }}
            scrollEnabled={!draggingCardId}
            scrollEventThrottle={16}
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
                  cards={cards}
                  column={column}
                  columnTone={columnTones[column]}
                  dragEnabled={!layout.compact}
                  draggingCardId={draggingCardId}
                  dropIndex={dragTarget?.column === column ? dragTarget.index : null}
                  onCardLayout={(cardId, cardColumn, event: LayoutChangeEvent) => {
                    if (cardColumn !== column) return;
                    cardLayouts.current.set(cardId, event.nativeEvent.layout);
                  }}
                  onColumnLayout={(measuredColumn, event: LayoutChangeEvent) => {
                    columnLayouts.current.set(measuredColumn, event.nativeEvent.layout);
                    measureBoardViewport();
                  }}
                  onDragCancel={cancelDrag}
                  onDragEnd={finishDrag}
                  onDragMove={updateDragTarget}
                  onDragStart={(card, pageX, pageY) => {
                    setDraggingCardId(card.id);
                    measureBoardViewport();
                    updateDragTarget(card, pageX, pageY);
                  }}
                  onViewDetails={(card) => {
                    setConfirmDeleteCardId(null);
                    setEditor(null);
                    closeLauncher();
                    setSelectedCardId(card.id);
                  }}
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
        </View>
      ) : selectedProjectId ? (
        <Text style={styles.muted}>Creating this project's board…</Text>
      ) : null}
    </View>
  );
}
