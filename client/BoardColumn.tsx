import { Pressable, Text, View } from "react-native";
import {
  BOARD_COLUMN_LABELS,
  type BoardColumn as Column,
  type Card,
  type Run,
} from "../shared/model";
import { adjacentColumn } from "../shared/operations";
import { isActiveAgent, runStatus, type RunStatusTone } from "../shared/runState";
import { RunStatusBadge } from "./RunStatusBadge";
import type { BoardStyles } from "./useBoardStyles";
import type { AgentSummary } from "./usePaseoDirectory";

type StatusPalette = Record<RunStatusTone, string>;

interface BoardColumnProps {
  agents: readonly AgentSummary[];
  allCards: readonly Card[];
  cards: readonly Card[];
  column: Column;
  columnTone: string;
  confirmDeleteCardId: string | null;
  onDelete: (cardId: string) => void;
  onEdit: (card: Card) => void;
  onViewDetails: (card: Card) => void;
  onMove: (card: Card, column: Column, index: number) => void;
  onMoveToEnd: (card: Card, column: Column) => void;
  onOpenAgent: ((agentId: string) => void) | undefined;
  onRequestChanges: (card: Card) => void;
  onRun: (card: Card) => void;
  runs: readonly Run[];
  statusPalette: StatusPalette;
  statusTextColor: string;
  styles: BoardStyles;
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
  onViewDetails,
  onMove,
  onMoveToEnd,
  onOpenAgent,
  onRequestChanges,
  onRun,
  runs,
  statusPalette,
  statusTextColor,
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
        const activeAgent = isActiveAgent(agent);
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
              <RunStatusBadge color={statusColor} status={status} textColor={statusTextColor} />
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
              {latestRun && onOpenAgent ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpenAgent(latestRun.agentId)}
                  style={[
                    styles.button,
                    card.column === "in_progress" && activeAgent && styles.primaryButton,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      card.column === "in_progress" &&
                        activeAgent &&
                        styles.primaryButtonText,
                    ]}
                  >
                    View Agent
                  </Text>
                </Pressable>
              ) : null}
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
              ) : card.column === "todo" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRun(card)}
                  style={[styles.button, styles.primaryButton]}
                >
                  <Text style={[styles.buttonText, styles.primaryButtonText]}>Start Agent</Text>
                </Pressable>
              ) : card.column === "in_progress" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRun(card)}
                  style={[styles.button, !latestRun && styles.primaryButton]}
                >
                  <Text style={[styles.buttonText, !latestRun && styles.primaryButtonText]}>
                    {latestRun ? "New Agent" : "Start Agent"}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onRequestChanges(card)}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>Request Changes</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onMoveToEnd(card, "done")}
                    style={[styles.button, styles.primaryButton]}
                  >
                    <Text style={[styles.buttonText, styles.primaryButtonText]}>Mark Done</Text>
                  </Pressable>
                </>
              )}
            </View>
            <View style={styles.cardActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View details and run history for ${card.key}`}
                onPress={() => onViewDetails(card)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Details</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onEdit(card)} style={styles.button}>
                <Text style={styles.buttonText}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${card.key}`}
                onPress={() => onDelete(card.id)}
                style={[styles.button, confirmDeleteCardId === card.id && styles.dangerButton]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    confirmDeleteCardId === card.id && styles.dangerButtonText,
                  ]}
                >
                  {confirmDeleteCardId === card.id ? "Confirm Delete" : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}
