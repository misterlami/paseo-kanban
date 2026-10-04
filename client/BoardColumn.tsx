import { Pressable, Text, View } from "react-native";
import {
  BOARD_COLUMN_LABELS,
  type BoardColumn as Column,
  type Card,
  type Run,
} from "../shared/model";
import { runStatus, type RunStatusTone } from "../shared/runState";
import { RunStatusBadge } from "./RunStatusBadge";
import type { BoardStyles } from "./useBoardStyles";
import type { AgentSummary } from "./usePaseoDirectory";

type StatusPalette = Record<RunStatusTone, string>;

interface BoardColumnProps {
  agents: readonly AgentSummary[];
  cards: readonly Card[];
  column: Column;
  columnTone: string;
  onViewDetails: (card: Card) => void;
  runs: readonly Run[];
  statusPalette: StatusPalette;
  statusTextColor: string;
  styles: BoardStyles;
}

export function BoardColumn({
  agents,
  cards,
  column,
  columnTone,
  onViewDetails,
  runs,
  statusPalette,
  statusTextColor,
  styles,
}: BoardColumnProps) {
  return (
    <View style={[styles.column, { borderTopColor: columnTone }]}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>{BOARD_COLUMN_LABELS[column].toUpperCase()}</Text>
        {column === "done" ? <Text style={styles.doneMark}>✓</Text> : null}
        <Text style={styles.count}>{cards.length}</Text>
      </View>
      {cards.map((card) => {
        const latestRun = runs
          .filter((run) => run.cardId === card.id)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const agent = latestRun
          ? agents.find((candidate) => candidate.id === latestRun.agentId)
          : undefined;
        const status = latestRun ? runStatus(agent) : null;
        const statusColor = status ? statusPalette[status.tone] : columnTone;
        const agentLabel = latestRun?.agentProfileName ?? agent?.model ?? latestRun?.provider;

        return (
          <Pressable
            key={card.id}
            accessibilityRole="button"
            accessibilityLabel={`${card.key}: ${card.title}${status ? `, ${status.label}` : ""}${agentLabel ? `, latest agent ${agentLabel}` : ""}`}
            accessibilityHint="Opens card details and actions"
            onPress={() => onViewDetails(card)}
            style={({ pressed }) => [
              styles.card,
              { borderLeftColor: statusColor },
              pressed && styles.pressedControl,
            ]}
          >
            <Text numberOfLines={2} style={styles.cardTitle}>
              {card.title}
            </Text>
            <View style={styles.cardFooter}>
              <View style={styles.cardMetadata}>
                <Text style={styles.cardKey}>{card.key}</Text>
                {status ? (
                  <RunStatusBadge color={statusColor} status={status} textColor={statusTextColor} />
                ) : null}
              </View>
              {agentLabel ? (
                <View style={[styles.agentMarker, { backgroundColor: statusColor }]}>
                  <Text style={[styles.agentMarkerText, { color: statusTextColor }]}>
                    {agentLabel.trim().charAt(0).toUpperCase() || "A"}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
