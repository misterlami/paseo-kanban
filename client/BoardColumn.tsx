import { Pressable, Text, View } from "react-native";
import {
  BOARD_COLUMN_LABELS,
  type BoardColumn as Column,
  type Card,
  type Run,
} from "../shared/model";
import { adjacentColumn } from "../shared/operations";
import type { BoardStyles } from "./useBoardStyles";
import type { AgentSummary } from "./usePaseoDirectory";

interface StatusPalette {
  accent: string;
  danger: string;
  muted: string;
  success: string;
  warning: string;
}

interface BoardColumnProps {
  agents: readonly AgentSummary[];
  allCards: readonly Card[];
  cards: readonly Card[];
  column: Column;
  columnTone: string;
  confirmDeleteCardId: string | null;
  onDelete: (cardId: string) => void;
  onEdit: (card: Card) => void;
  onMove: (card: Card, column: Column, index: number) => void;
  onMoveToEnd: (card: Card, column: Column) => void;
  onOpenAgent: ((agentId: string) => void) | undefined;
  onRun: (cardId: string) => void;
  runs: readonly Run[];
  statusPalette: StatusPalette;
  styles: BoardStyles;
}

function runStatus(agent: AgentSummary | undefined): {
  label: string;
  tone: keyof StatusPalette;
} {
  if (!agent) return { label: "Agent missing", tone: "warning" };
  if (agent.archivedAt) return { label: "Archived", tone: "muted" };
  if (agent.attentionReason === "permission") return { label: "Permission required", tone: "warning" };
  if (agent.attentionReason === "error" || agent.status === "error") {
    return { label: "Error", tone: "danger" };
  }
  if (agent.attentionReason === "finished") return { label: "Review suggested", tone: "success" };
  if (agent.status === "running" || agent.status === "initializing") {
    return { label: "Running", tone: "accent" };
  }
  if (agent.status === "closed") return { label: "Closed", tone: "muted" };
  return { label: "Idle", tone: "muted" };
}

export function BoardColumn({
  agents,
  allCards,
  cards,
  column,
  columnTone,
  confirmDeleteCardId,
  onDelete,
  onEdit,
  onMove,
  onMoveToEnd,
  onOpenAgent,
  onRun,
  runs,
  statusPalette,
  styles,
}: BoardColumnProps) {
  return (
    <View style={[styles.column, { borderTopColor: columnTone }]}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>{BOARD_COLUMN_LABELS[column]}</Text>
        <Text style={styles.count}>{cards.length}</Text>
      </View>
      {cards.map((card) => {
        const position = allCards.findIndex((candidate) => candidate.id === card.id);
        const latestRun = runs
          .filter((run) => run.cardId === card.id)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const agent = latestRun
          ? agents.find((candidate) => candidate.id === latestRun.agentId)
          : undefined;
        const status = latestRun ? runStatus(agent) : null;
        const statusColor = status ? statusPalette[status.tone] : columnTone;
        const left = adjacentColumn(card.column, -1);
        const right = adjacentColumn(card.column, 1);

        return (
          <View key={card.id} style={[styles.card, { borderLeftColor: statusColor }]}>
            <Text style={styles.cardKey}>{card.key}</Text>
            <Text numberOfLines={2} style={styles.cardTitle}>
              {card.title}
            </Text>
            {card.description ? (
              <Text numberOfLines={3} style={styles.muted}>
                {card.description}
              </Text>
            ) : null}
            {status ? (
              <View style={[styles.badge, { backgroundColor: statusColor }]}>
                <Text style={styles.badgeText}>{status.label}</Text>
              </View>
            ) : null}
            <View style={styles.cardActions}>
              {left ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${card.key} to ${BOARD_COLUMN_LABELS[left]}`}
                  onPress={() => onMoveToEnd(card, left)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>←</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${card.key} up`}
                disabled={position === 0}
                onPress={() => onMove(card, column, position - 1)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${card.key} down`}
                disabled={position === allCards.length - 1}
                onPress={() => onMove(card, column, position + 1)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>↓</Text>
              </Pressable>
              {right ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${card.key} to ${BOARD_COLUMN_LABELS[right]}`}
                  onPress={() => onMoveToEnd(card, right)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>→</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.cardActions}>
              <Pressable accessibilityRole="button" onPress={() => onEdit(card)} style={styles.button}>
                <Text style={styles.buttonText}>Edit</Text>
              </Pressable>
              {card.column === "backlog" || card.column === "done" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${card.column === "done" ? "Reopen" : "Move"} ${card.key} to Ready`}
                  onPress={() => onMoveToEnd(card, "todo")}
                  style={[styles.button, styles.primaryButton]}
                >
                  <Text style={[styles.buttonText, styles.primaryButtonText]}>
                    {card.column === "done" ? "Reopen to Ready" : "Move to Ready"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRun(card.id)}
                  style={[styles.button, styles.primaryButton]}
                >
                  <Text style={[styles.buttonText, styles.primaryButtonText]}>Run agent</Text>
                </Pressable>
              )}
              {latestRun && onOpenAgent ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpenAgent(latestRun.agentId)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Open agent</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => onDelete(card.id)}
                style={[styles.button, confirmDeleteCardId === card.id && styles.dangerButton]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    confirmDeleteCardId === card.id && styles.dangerButtonText,
                  ]}
                >
                  {confirmDeleteCardId === card.id ? "Confirm delete" : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}
