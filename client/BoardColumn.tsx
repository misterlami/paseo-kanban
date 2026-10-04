import { useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
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
  dragEnabled: boolean;
  draggingCardId: string | null;
  dropIndex: number | null;
  onCardLayout: (cardId: string, column: Column, event: LayoutChangeEvent) => void;
  onColumnLayout: (column: Column, event: LayoutChangeEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (card: Card, pageX: number, pageY: number) => void;
  onDragMove: (card: Card, pageX: number, pageY: number) => void;
  onDragStart: (card: Card, pageX: number, pageY: number) => void;
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
  dragEnabled,
  draggingCardId,
  dropIndex,
  onCardLayout,
  onColumnLayout,
  onDragCancel,
  onDragEnd,
  onDragMove,
  onDragStart,
  onViewDetails,
  runs,
  statusPalette,
  statusTextColor,
  styles,
}: BoardColumnProps) {
  const containsDraggingCard = cards.some((card) => card.id === draggingCardId);
  const dropCards = cards.filter((card) => card.id !== draggingCardId);
  const beforeCardId = dropIndex === null ? null : dropCards[dropIndex]?.id ?? null;
  const showTrailingDropTarget = dropIndex !== null && dropIndex === dropCards.length;

  return (
    <View
      onLayout={(event) => onColumnLayout(column, event)}
      style={[
        styles.column,
        containsDraggingCard && styles.draggingColumn,
        { borderTopColor: columnTone },
      ]}
    >
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
          <DraggableCard
            key={card.id}
            agentLabel={agentLabel}
            card={card}
            dragEnabled={dragEnabled}
            dragging={draggingCardId === card.id}
            dropBefore={beforeCardId === card.id}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
            onDragMove={onDragMove}
            onDragStart={onDragStart}
            onLayout={onCardLayout}
            onViewDetails={onViewDetails}
            status={status}
            statusColor={statusColor}
            statusTextColor={statusTextColor}
            styles={styles}
          />
        );
      })}
      {showTrailingDropTarget ? <View style={styles.dropIndicator} /> : null}
    </View>
  );
}

interface DraggableCardProps {
  agentLabel: string | null | undefined;
  card: Card;
  dragEnabled: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onDragCancel: () => void;
  onDragEnd: (card: Card, pageX: number, pageY: number) => void;
  onDragMove: (card: Card, pageX: number, pageY: number) => void;
  onDragStart: (card: Card, pageX: number, pageY: number) => void;
  onLayout: (cardId: string, column: Column, event: LayoutChangeEvent) => void;
  onViewDetails: (card: Card) => void;
  status: ReturnType<typeof runStatus> | null;
  statusColor: string;
  statusTextColor: string;
  styles: BoardStyles;
}

function DraggableCard({
  agentLabel,
  card,
  dragEnabled,
  dragging,
  dropBefore,
  onDragCancel,
  onDragEnd,
  onDragMove,
  onDragStart,
  onLayout,
  onViewDetails,
  status,
  statusColor,
  statusTextColor,
  styles,
}: DraggableCardProps) {
  const translation = useRef(new Animated.ValueXY()).current;
  const handlers = useRef({ card, dragEnabled, onDragCancel, onDragEnd, onDragMove, onDragStart });
  handlers.current = { card, dragEnabled, onDragCancel, onDragEnd, onDragMove, onDragStart };
  const responder = useMemo(
    () => {
      const shouldClaimDrag = (_event: unknown, gesture: { dx: number; dy: number }) =>
        handlers.current.dragEnabled && Math.hypot(gesture.dx, gesture.dy) >= 6;
      return PanResponder.create({
        onMoveShouldSetPanResponder: shouldClaimDrag,
        onMoveShouldSetPanResponderCapture: shouldClaimDrag,
        onPanResponderGrant: (event) => {
          translation.setValue({ x: 0, y: 0 });
          handlers.current.onDragStart(
            handlers.current.card,
            event.nativeEvent.pageX,
            event.nativeEvent.pageY,
          );
        },
        onPanResponderMove: (_event, gesture) => {
          translation.setValue({ x: gesture.dx, y: gesture.dy });
          handlers.current.onDragMove(handlers.current.card, gesture.moveX, gesture.moveY);
        },
        onPanResponderRelease: (_event, gesture) => {
          handlers.current.onDragEnd(handlers.current.card, gesture.moveX, gesture.moveY);
          translation.setValue({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => {
          handlers.current.onDragCancel();
          translation.setValue({ x: 0, y: 0 });
        },
        onPanResponderTerminationRequest: () => false,
      });
    },
    [translation],
  );

  return (
    <Animated.View
      {...(dragEnabled ? responder.panHandlers : {})}
      onLayout={(event) => onLayout(card.id, card.column, event)}
      style={[
        styles.card,
        { borderLeftColor: statusColor },
        dragging && styles.draggingCard,
        { transform: translation.getTranslateTransform() },
      ]}
    >
      {dropBefore ? <View pointerEvents="none" style={styles.dropIndicatorOverlay} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${card.key}: ${card.title}${status ? `, ${status.label}` : ""}${agentLabel ? `, latest agent ${agentLabel}` : ""}`}
        accessibilityHint={dragEnabled ? "Press for details, or drag to move" : "Opens card details and actions"}
        onPress={() => onViewDetails(card)}
        style={({ pressed }) => [styles.cardContent, pressed && !dragging && styles.pressedControl]}
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
    </Animated.View>
  );
}
