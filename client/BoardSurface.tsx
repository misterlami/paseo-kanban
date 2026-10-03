import { settingsRpc } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  AGENT_LABELS,
  BOARD_COLUMNS,
  BoardDataSchema,
  type BoardColumn,
  type BoardData,
  type Card,
  type DisplaySettings,
} from "../shared/model";
import {
  applyBoardOperations,
  boardForProject,
  cardsInColumn,
  createId,
  type BoardOperation,
} from "../shared/operations";
import { boardDataSettings, displaySettings } from "../shared/settings";
import { BoardColumn as BoardColumnView } from "./BoardColumn";
import {
  AgentLauncherPanel,
  CardEditorPanel,
  type EditorState,
  ImportPanel,
} from "./BoardPanels";
import { errorMessage } from "./errors";
import { ProjectPicker } from "./ProjectPicker";
import { useBoardStyles } from "./useBoardStyles";
import { usePaseoDirectory } from "./usePaseoDirectory";

const boardRpc = settingsRpc(boardDataSettings.id);
const displayRpc = settingsRpc(displaySettings.id);
type NullableString = string | null;

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
  const [runCardId, setRunCardId] = useState<NullableString>(null);
  const [workspaceId, setWorkspaceId] = useState<NullableString>(null);
  const [providerModel, setProviderModel] = useState<NullableString>(null);
  const [startingAgent, setStartingAgent] = useState(false);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = useState<NullableString>(null);
  const [importText, setImportText] = useState<NullableString>(null);
  const [importValidated, setImportValidated] = useState<BoardData | null>(null);
  const ensuringProject = useRef<NullableString>(null);
  const displayInitialized = useRef(false);
  const reconciling = useRef(false);
  const styles = useBoardStyles(theme, layout.compact);

  const currentBoard =
    boardSettings.status === "ready" && selectedProjectId
      ? boardForProject(boardSettings.values, selectedProjectId)
      : undefined;
  const directory = usePaseoDirectory(selectedProjectId, currentBoard?.id ?? null);

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
    if (!workspaceId || !directory.workspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(directory.workspaces[0]?.id ?? null);
    }
  }, [directory.workspaces, workspaceId]);

  useEffect(() => {
    if (!providerModel || !directory.models.some((model) => model.id === providerModel)) {
      setProviderModel(directory.models[0]?.id ?? null);
    }
  }, [directory.models, providerModel]);

  useEffect(() => {
    if (boardSettings.status !== "ready" || directory.agents.length === 0) return;
    if (reconciling.current) return;
    const links = directory.agents.flatMap((agent) => {
      const workspace = agent.workspaceId;
      if (!workspace) return [];
      return [
        {
          agentId: agent.id,
          workspaceId: workspace,
          provider: agent.provider,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          labels: agent.labels,
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
  }, [boardSettings, directory.agents, persistOperations, toast]);

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
  const columnTones: Record<BoardColumn, string> = {
    backlog: theme.colors.foregroundMuted,
    todo: theme.colors.border,
    in_progress: theme.colors.statusWarning,
    in_review: theme.colors.statusSuccess,
    done: theme.colors.accent,
  };

  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setProjectPickerOpen(false);
    setProjectFilter("");
    setEditor(null);
    setRunCardId(null);
    void persistDisplay((values) => ({ ...values, selectedProjectId: projectId })).catch((cause) =>
      toast.error(errorMessage(cause)),
    );
  };

  const saveEditor = async () => {
    if (!editor || !board) return;
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
      await action([operation]);
      setEditor(null);
    } catch {
      // The editor remains open so the user's input is not lost.
    }
  };

  const moveCard = (card: Card, column: BoardColumn, index: number) => {
    void action([
      { type: "move-card", cardId: card.id, column, index, now: new Date().toISOString() },
    ]).catch(() => undefined);
  };

  const startAgent = async () => {
    if (!board || !runCardId || !workspaceId || !providerModel) return;
    const card = boardSettings.values.cards.find((candidate) => candidate.id === runCardId);
    if (!card || card.boardId !== board.id) return;
    if (card.column === "backlog" || card.column === "done") {
      setRunCardId(null);
      toast.error("Move the card to Ready before starting an agent.");
      return;
    }
    setStartingAgent(true);
    const runId = createId("run");
    const now = new Date().toISOString();
    try {
      const agent = await paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: providerModel },
        title: `${card.key}: ${card.title}`,
        labels: {
          [AGENT_LABELS.boardId]: board.id,
          [AGENT_LABELS.cardId]: card.id,
          [AGENT_LABELS.runId]: runId,
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
            workspaceId,
            provider: providerModel,
            createdAt: agent.current()?.createdAt ?? now,
            updatedAt: agent.current()?.updatedAt ?? now,
          },
        },
      ];
      if (card.column === "todo") {
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
      setRunCardId(null);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setStartingAgent(false);
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
          onPress={() =>
            setEditor({ mode: "create", cardId: null, title: "", description: "", column: "backlog" })
          }
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
          saving={boardSettings.saving}
          styles={styles}
        />
      ) : null}

      {runCardId ? (
        <AgentLauncherPanel
          models={directory.models}
          onCancel={() => setRunCardId(null)}
          onModelChange={setProviderModel}
          onStart={() => void startAgent()}
          onWorkspaceChange={setWorkspaceId}
          providerModel={providerModel}
          starting={startingAgent}
          styles={styles}
          workspaceId={workspaceId}
          workspaces={directory.workspaces}
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
                columnTone={columnTones[column]}
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
                onEdit={(card) =>
                  setEditor({
                    mode: "edit",
                    cardId: card.id,
                    title: card.title,
                    description: card.description,
                    column: card.column,
                  })
                }
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
                onRun={setRunCardId}
                runs={boardSettings.values.runs}
                statusPalette={{
                  accent: theme.colors.accent,
                  danger: theme.colors.statusDanger,
                  muted: theme.colors.foregroundMuted,
                  success: theme.colors.statusSuccess,
                  warning: theme.colors.statusWarning,
                }}
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
