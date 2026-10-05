import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  type BoardColumn,
  type BoardData,
} from "../shared/model";
import { runStatus, type RunStatusTone } from "../shared/runState";
import { RunStatusBadge } from "./RunStatusBadge";
import type { BoardStyles } from "./useBoardStyles";
import type { AgentSummary, ProjectSummary } from "./usePaseoDirectory";

type StatusFilter =
  | "all"
  | "running"
  | "needs_input"
  | "failed"
  | "needs_review"
  | "idle"
  | "archived"
  | "unknown"
  | "no_run";

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All runs",
  running: "Running",
  needs_input: "Needs input",
  failed: "Failed",
  needs_review: "Needs review",
  idle: "Idle",
  archived: "Archived",
  unknown: "Unknown",
  no_run: "No run",
};

function statusFilterFor(label: string | undefined): StatusFilter {
  if (!label) return "no_run";
  if (label === "Running" || label === "Initializing") return "running";
  if (label === "Needs input") return "needs_input";
  if (label === "Failed") return "failed";
  if (label === "Needs review") return "needs_review";
  if (label === "Idle") return "idle";
  if (label === "Archived" || label === "Closed") return "archived";
  if (label === "Unknown") return "unknown";
  return "unknown";
}

interface AllProjectsPanelProps {
  agents: readonly AgentSummary[];
  data: BoardData;
  filter: string;
  onOpenProject: (projectId: string, cardId: string) => void;
  projects: readonly ProjectSummary[];
  statusPalette: Record<RunStatusTone, string>;
  statusTextColor: string;
  styles: BoardStyles;
}

export function AllProjectsPanel({
  agents,
  data,
  filter,
  onOpenProject,
  projects,
  statusPalette,
  statusTextColor,
  styles,
}: AllProjectsPanelProps) {
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [columnFilter, setColumnFilter] = useState<BoardColumn | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const normalizedFilter = filter.trim().toLowerCase();
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const latestRunByCard = new Map(
    data.cards.flatMap((card) => {
      const latest = data.runs
        .filter((run) => run.cardId === card.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return latest ? [[card.id, latest] as const] : [];
    }),
  );
  const groups = data.boards
    .map((board) => ({
      board,
      project: projectById.get(board.projectId),
      cards: data.cards
        .filter((card) => card.boardId === board.id)
        .filter((card) => columnFilter === "all" || card.column === columnFilter)
        .filter((card) => {
          if (statusFilter === "all") return true;
          const run = latestRunByCard.get(card.id);
          const agent = run ? agents.find((candidate) => candidate.id === run.agentId) : undefined;
          return statusFilterFor(run ? runStatus(agent).label : undefined) === statusFilter;
        })
        .filter(
          (card) =>
            !normalizedFilter ||
            `${board.name} ${card.key} ${card.title} ${card.description}`
              .toLowerCase()
              .includes(normalizedFilter),
        )
        .sort(
          (left, right) =>
            BOARD_COLUMNS.indexOf(left.column) - BOARD_COLUMNS.indexOf(right.column) ||
            left.position - right.position ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    }))
    .filter(
      (group) =>
        group.project &&
        (projectFilter === "all" || group.project.projectId === projectFilter) &&
        (!(normalizedFilter || columnFilter !== "all" || statusFilter !== "all") || group.cards.length > 0),
    )
    .sort((left, right) => left.board.name.localeCompare(right.board.name));
  const cardCount = groups.reduce((total, group) => total + group.cards.length, 0);

  return (
    <ScrollView style={styles.boardViewport} contentContainerStyle={styles.formFields}>
      <View style={styles.panel}>
        <Text style={styles.sectionLabel}>Project</Text>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: projectFilter === "all" }}
            onPress={() => setProjectFilter("all")}
            style={[styles.chip, projectFilter === "all" && styles.selectedChip]}
          >
            <Text style={[styles.buttonText, projectFilter === "all" && styles.selectedChipText]}>All</Text>
          </Pressable>
          {data.boards.map((board) => (
            <Pressable
              key={board.id}
              accessibilityRole="button"
              accessibilityState={{ selected: projectFilter === board.projectId }}
              onPress={() => setProjectFilter(board.projectId)}
              style={[styles.chip, projectFilter === board.projectId && styles.selectedChip]}
            >
              <Text style={[styles.buttonText, projectFilter === board.projectId && styles.selectedChipText]}>
                {board.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionLabel}>Column</Text>
        <View style={styles.toolbar}>
          {(["all", ...BOARD_COLUMNS] as const).map((column) => (
            <Pressable
              key={column}
              accessibilityRole="button"
              accessibilityState={{ selected: columnFilter === column }}
              onPress={() => setColumnFilter(column)}
              style={[styles.chip, columnFilter === column && styles.selectedChip]}
            >
              <Text style={[styles.buttonText, columnFilter === column && styles.selectedChipText]}>
                {column === "all" ? "All" : BOARD_COLUMN_LABELS[column]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionLabel}>Agent state</Text>
        <View style={styles.toolbar}>
          {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((status) => (
            <Pressable
              key={status}
              accessibilityRole="button"
              accessibilityState={{ selected: statusFilter === status }}
              onPress={() => setStatusFilter(status)}
              style={[styles.chip, statusFilter === status && styles.selectedChip]}
            >
              <Text style={[styles.buttonText, statusFilter === status && styles.selectedChipText]}>
                {STATUS_FILTER_LABELS[status]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={styles.muted}>
        {cardCount} {cardCount === 1 ? "card" : "cards"} across {groups.length}{" "}
        {groups.length === 1 ? "project" : "projects"}
      </Text>
      {groups.map(({ board, project, cards }) => (
        <View key={board.id} style={styles.panel}>
          <View style={styles.detailsHeader}>
            <View style={styles.detailsHeading}>
              <Text style={styles.launcherTitle}>{board.name}</Text>
              <Text style={styles.muted}>{cards.length} visible cards</Text>
            </View>
          </View>
          {cards.map((card) => (
            (() => {
              const run = latestRunByCard.get(card.id);
              const agent = run ? agents.find((candidate) => candidate.id === run.agentId) : undefined;
              const status = run ? runStatus(agent) : null;
              return (
                <Pressable
                  key={card.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${card.key}: ${card.title} in ${board.name}`}
                  onPress={() => onOpenProject(project!.projectId, card.id)}
                  style={({ pressed }) => [styles.card, pressed && styles.pressedControl]}
                >
                  <View style={styles.cardContent}>
                    <Text numberOfLines={2} style={styles.cardTitle}>{card.title}</Text>
                    <View style={styles.cardMetadata}>
                      <Text style={styles.cardKey}>{card.key}</Text>
                      <Text style={styles.detailsStatus}>{BOARD_COLUMN_LABELS[card.column]}</Text>
                      {status ? (
                        <RunStatusBadge
                          color={statusPalette[status.tone]}
                          status={status}
                          textColor={statusTextColor}
                        />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })()
          ))}
          {cards.length === 0 ? <Text style={styles.muted}>No cards.</Text> : null}
        </View>
      ))}
      {groups.length === 0 ? <Text style={styles.muted}>No matching project cards.</Text> : null}
    </ScrollView>
  );
}
