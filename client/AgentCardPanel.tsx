import { settingsRpc } from "@getpaseo/plugin";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useAgent, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BOARD_COLUMN_LABELS, BoardDataSchema, type BoardColumn, type Run } from "../shared/model";
import { applyBoardOperation, cardsInColumn } from "../shared/operations";
import { runStatus } from "../shared/runState";
import { boardDataSettings } from "../shared/settings";
import { errorMessage } from "./errors";
import { RunStatusBadge } from "./RunStatusBadge";

const boardRpc = settingsRpc(boardDataSettings.id);

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

interface RunRowProps {
  hostId: string;
  isCandidate: boolean;
  navigation: PluginAgentPanelProps["navigation"];
  run: Run;
  styles: ReturnType<typeof createStyles>;
  theme: PluginAgentPanelProps["theme"];
}

function RunRow({ hostId, isCandidate, navigation, run, styles, theme }: RunRowProps) {
  const agent = useAgent(run.agentId, (snapshot) => ({
    attentionReason: snapshot.attentionReason,
    model: snapshot.model,
    status: snapshot.status,
    title: snapshot.title,
    updatedAt: snapshot.updatedAt,
  }));
  const status = runStatus(agent);
  const statusColor = {
    accent: theme.colors.accent,
    danger: theme.colors.statusDanger,
    muted: theme.colors.foregroundMuted,
    success: theme.colors.statusSuccess,
    warning: theme.colors.statusWarning,
  }[status.tone];

  return (
    <View style={styles.run}>
      <View style={styles.rowWrap}>
        <Text style={styles.runTitle}>{agent?.title ?? run.agentProfileName ?? "Agent attempt"}</Text>
        {isCandidate ? <Text style={styles.candidate}>Review candidate</Text> : null}
        <RunStatusBadge
          color={statusColor}
          status={status}
          textColor={theme.colors.accentForeground}
        />
      </View>
      <Text style={styles.muted}>Profile: {run.agentProfileName ?? agent?.model ?? run.provider}</Text>
      <Text style={styles.muted}>Workspace: {run.workspaceName ?? run.workspaceId}</Text>
      {run.branchName ? <Text style={styles.muted}>Branch: {run.branchName}</Text> : null}
      <Text style={styles.muted}>Started: {formatTimestamp(run.createdAt)}</Text>
      <Text style={styles.muted}>Updated: {formatTimestamp(agent?.updatedAt ?? run.updatedAt)}</Text>
      {navigation ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.openAgent({ agentId: run.agentId, serverId: hostId })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>View Agent</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: PluginAgentPanelProps["theme"], compact: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      padding: compact ? 12 : 16,
      gap: 12,
      backgroundColor: theme.colors.surface0,
    },
    header: { gap: 4 },
    key: { color: theme.colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
    title: { color: theme.colors.foreground, fontSize: compact ? 18 : 21, fontWeight: "800" },
    text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    error: { color: theme.colors.statusDanger, fontSize: 13 },
    status: {
      alignSelf: "flex-start",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
      color: theme.colors.foreground,
      fontSize: 11,
      fontWeight: "700",
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    button: {
      alignSelf: "flex-start",
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
    },
    primaryButton: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accent },
    buttonText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" },
    primaryButtonText: { color: theme.colors.accentForeground },
    sectionTitle: {
      color: theme.colors.foreground,
      fontSize: 12,
      fontWeight: "800",
      paddingTop: 4,
    },
    history: { flexGrow: 0 },
    historyContent: { gap: 8, paddingBottom: 12 },
    run: {
      gap: 5,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
    rowWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
    runTitle: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" },
    candidate: {
      color: theme.colors.accent,
      borderColor: theme.colors.accent,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 2,
      fontSize: 10,
      fontWeight: "700",
    },
  });
}

export function AgentCardPanel({ agentId, host, layout, navigation, theme }: PluginAgentPanelProps) {
  const settings = useSettings(boardDataSettings);
  const readBoard = useRpc(boardRpc.read);
  const toast = useToast();
  const currentAgent = useAgent(agentId, (snapshot) => ({
    attentionReason: snapshot.attentionReason,
  }));
  const styles = useMemo(() => createStyles(theme, layout.compact), [layout.compact, theme]);

  if (settings.status === "loading") {
    return <View style={styles.screen}><Text style={styles.muted}>Loading Kanban card…</Text></View>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return <View style={styles.screen}><Text style={styles.error}>{settings.error}</Text></View>;
  }

  const linkedRun = settings.values.runs.find((run) => run.agentId === agentId);
  const card = linkedRun
    ? settings.values.cards.find((candidate) => candidate.id === linkedRun.cardId)
    : undefined;

  if (!linkedRun || !card) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Kanban card</Text>
        <Text style={styles.muted}>This agent is not linked to a Kanban card.</Text>
      </View>
    );
  }

  const history = settings.values.runs
    .filter((run) => run.cardId === card.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const moveCard = async (column: BoardColumn) => {
    const operation = {
      type: "move-card" as const,
      cardId: card.id,
      column,
      index: cardsInColumn(settings.values, card.boardId, column).length,
      now: new Date().toISOString(),
    };
    try {
      const next = BoardDataSchema.parse(applyBoardOperation(settings.values, operation));
      if (!(await settings.save(next, settings.revision))) {
        const fresh = await readBoard({});
        if (fresh.status !== "ready") throw new Error(fresh.error);
        const replayed = BoardDataSchema.parse(
          applyBoardOperation(BoardDataSchema.parse(fresh.values), operation),
        );
        if (!(await settings.save(replayed, fresh.revision))) {
          throw new Error("Board changed again while saving. Retry the action.");
        }
      }
      toast.show(`Moved ${card.key} to ${BOARD_COLUMN_LABELS[column]}`, { variant: "success" });
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const canSuggestReview =
    card.column === "in_progress" && currentAgent?.attentionReason === "finished";

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.key}>{card.key}</Text>
        <Text style={styles.title}>{card.title}</Text>
      </View>
      <Text style={styles.status}>{BOARD_COLUMN_LABELS[card.column]}</Text>
      {card.description ? <Text style={styles.text}>{card.description}</Text> : null}
      <View style={styles.actions}>
        {canSuggestReview ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void moveCard("in_review")}
            style={[styles.button, styles.primaryButton]}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>Move to Review</Text>
          </Pressable>
        ) : null}
        {card.column === "in_review" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void moveCard("done")}
            style={[styles.button, styles.primaryButton]}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>Mark Done</Text>
          </Pressable>
        ) : null}
        {card.column === "done" ? (
          <Pressable accessibilityRole="button" onPress={() => void moveCard("todo")} style={styles.button}>
            <Text style={styles.buttonText}>Reopen to Ready</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.sectionTitle}>Run history</Text>
      <ScrollView style={styles.history} contentContainerStyle={styles.historyContent}>
        {history.map((run, index) => (
          <RunRow
            key={run.id}
            hostId={host.id}
            isCandidate={index === 0}
            navigation={navigation}
            run={run}
            styles={styles}
            theme={theme}
          />
        ))}
      </ScrollView>
    </View>
  );
}
