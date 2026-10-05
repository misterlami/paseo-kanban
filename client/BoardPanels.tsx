import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { AgentProfile } from "../shared/agentProfiles";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  type BoardColumn,
  type Card,
  type Run,
} from "../shared/model";
import { adjacentColumn } from "../shared/operations";
import { isActiveAgent, runStatus, type RunStatusTone } from "../shared/runState";
import { RunStatusBadge } from "./RunStatusBadge";
import type { BoardStyles } from "./useBoardStyles";
import type { AgentSummary, WorkspaceSummary } from "./usePaseoDirectory";

const PROFILE_COLORS: Record<string, string> = {
  slate: "#64748b",
  gray: "#6b7280",
  zinc: "#71717a",
  neutral: "#737373",
  stone: "#78716c",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

function profileColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return PROFILE_COLORS[color.toLowerCase()] ?? color;
}

function profileIconName(icon: string | undefined): string {
  if (!icon) return "Bot";
  return icon
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
}

function ChoiceIndicator({ selected, styles }: { selected: boolean; styles: BoardStyles }) {
  return (
    <View style={[styles.choiceIndicator, selected && styles.selectedChoiceIndicator]}>
      {selected ? <View style={styles.choiceIndicatorDot} /> : null}
    </View>
  );
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

export interface EditorState {
  mode: "create" | "edit";
  cardId: string | null;
  title: string;
  description: string;
  column: BoardColumn;
}

interface CardEditorPanelProps {
  editor: EditorState;
  onCancel: () => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
  placeholderColor: string;
  saving: boolean;
  styles: BoardStyles;
}

export function CardEditorPanel({
  editor,
  onCancel,
  onChange,
  onSave,
  placeholderColor,
  saving,
  styles,
}: CardEditorPanelProps) {
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);
  const saveDisabled = !editor.title.trim() || saving;

  return (
    <View style={styles.panel}>
      <Text style={styles.cardTitle}>{editor.mode === "create" ? "Create card" : "Edit card"}</Text>
      <TextInput
        accessibilityLabel="Card title"
        placeholder="Title"
        placeholderTextColor={placeholderColor}
        value={editor.title}
        editable={!saving}
        onChangeText={(title) => onChange({ ...editor, title })}
        style={[styles.input, saving && styles.disabledInput]}
      />
      <TextInput
        accessibilityLabel="Card description"
        multiline
        placeholder="Description"
        placeholderTextColor={placeholderColor}
        value={editor.description}
        editable={!saving}
        onChangeText={(description) => onChange({ ...editor, description })}
        style={[styles.input, styles.descriptionInput, saving && styles.disabledInput]}
      />
      {editor.mode === "create" ? (
        <View style={styles.toolbar}>
          {BOARD_COLUMNS.map((column) => {
            const selected = editor.column === column;
            return (
              <Pressable
                key={column}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving, selected }}
                disabled={saving}
                onHoverIn={() => setHoveredControl(column)}
                onHoverOut={() => setHoveredControl((current) => current === column ? null : current)}
                onPress={() => onChange({ ...editor, column })}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.selectedChip,
                  hoveredControl === column && !saving && styles.hoveredControl,
                  pressed && styles.pressedControl,
                  saving && styles.disabledControl,
                ]}
              >
                <Text style={[styles.buttonText, selected && styles.selectedChipText]}>
                  {BOARD_COLUMN_LABELS[column]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: saveDisabled }}
          disabled={saveDisabled}
          onHoverIn={() => setHoveredControl("save")}
          onHoverOut={() => setHoveredControl((current) => current === "save" ? null : current)}
          onPress={onSave}
          style={({ pressed }) => [
            styles.button,
            styles.editorAction,
            styles.primaryButton,
            hoveredControl === "save" && !saveDisabled && styles.hoveredControl,
            pressed && styles.pressedControl,
            saveDisabled && styles.disabledControl,
          ]}
        >
          <Text style={[
            styles.buttonText,
            styles.primaryButtonText,
            saveDisabled && styles.disabledControlText,
          ]}>
            {saving ? "Saving…" : "Save"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          onHoverIn={() => setHoveredControl("cancel")}
          onHoverOut={() => setHoveredControl((current) => current === "cancel" ? null : current)}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.button,
            styles.editorAction,
            hoveredControl === "cancel" && !saving && styles.hoveredControl,
            pressed && styles.pressedControl,
            saving && styles.disabledControl,
          ]}
        >
          <Text style={[styles.buttonText, saving && styles.disabledControlText]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface CardDetailsPanelProps {
  agents: readonly AgentSummary[];
  allCards: readonly Card[];
  card: Card;
  confirmDeleteCardId: string | null;
  onClose: () => void;
  onDelete: (cardId: string) => void;
  onEdit: (card: Card) => void;
  onMove: (card: Card, column: BoardColumn, index: number) => void;
  onMoveToEnd: (card: Card, column: BoardColumn) => void;
  onNewAttempt: (card: Card) => void;
  onOpenAgent: ((agentId: string) => void) | undefined;
  onRequestChanges: (card: Card) => void;
  runs: readonly Run[];
  statusPalette: Record<RunStatusTone, string>;
  statusTextColor: string;
  styles: BoardStyles;
  workspaces: readonly WorkspaceSummary[];
}

export function CardDetailsPanel({
  agents,
  allCards,
  card,
  confirmDeleteCardId,
  onClose,
  onDelete,
  onEdit,
  onMove,
  onMoveToEnd,
  onNewAttempt,
  onOpenAgent,
  onRequestChanges,
  runs,
  statusPalette,
  statusTextColor,
  styles,
  workspaces,
}: CardDetailsPanelProps) {
  const history = runs
    .filter((run) => run.cardId === card.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const position = allCards.findIndex((candidate) => candidate.id === card.id);
  const latestRun = history[0];
  const latestAgent = latestRun
    ? agents.find((candidate) => candidate.id === latestRun.agentId)
    : undefined;
  const activeAgent = isActiveAgent(latestAgent);
  const left = adjacentColumn(card.column, -1);
  const right = adjacentColumn(card.column, 1);

  return (
    <View style={styles.panel}>
      <View style={styles.detailsHeader}>
        <View style={styles.detailsHeading}>
          <Text style={styles.cardKey}>{card.key}</Text>
          <Text style={styles.launcherTitle}>{card.title}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
          <Text style={styles.buttonText}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.detailsStatus}>{BOARD_COLUMN_LABELS[card.column]}</Text>
      {card.description ? <Text style={styles.text}>{card.description}</Text> : null}

      <View style={styles.detailsSectionHeader}>
        <Text style={styles.sectionLabel}>Actions</Text>
      </View>
      <View style={styles.cardActions}>
        {left ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move ${card.key} to ${BOARD_COLUMN_LABELS[left]}`}
            onPress={() => onMoveToEnd(card, left)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>← {BOARD_COLUMN_LABELS[left]}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${card.key} up`}
          accessibilityState={{ disabled: position === 0 }}
          disabled={position === 0}
          onPress={() => onMove(card, card.column, position - 1)}
          style={[styles.button, position === 0 && styles.disabledControl]}
        >
          <Text style={[styles.buttonText, position === 0 && styles.disabledControlText]}>↑ Up</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${card.key} down`}
          accessibilityState={{ disabled: position === allCards.length - 1 }}
          disabled={position === allCards.length - 1}
          onPress={() => onMove(card, card.column, position + 1)}
          style={[styles.button, position === allCards.length - 1 && styles.disabledControl]}
        >
          <Text style={[styles.buttonText, position === allCards.length - 1 && styles.disabledControlText]}>
            ↓ Down
          </Text>
        </Pressable>
        {right ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move ${card.key} to ${BOARD_COLUMN_LABELS[right]}`}
            onPress={() => onMoveToEnd(card, right)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{BOARD_COLUMN_LABELS[right]} →</Text>
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
                card.column === "in_progress" && activeAgent && styles.primaryButtonText,
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
            onPress={() => onNewAttempt(card)}
            style={[styles.button, styles.primaryButton]}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>Start Agent</Text>
          </Pressable>
        ) : card.column === "in_progress" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onNewAttempt(card)}
            style={[styles.button, !latestRun && styles.primaryButton]}
          >
            <Text style={[styles.buttonText, !latestRun && styles.primaryButtonText]}>
              {latestRun ? "New Agent" : "Start Agent"}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => onRequestChanges(card)} style={styles.button}>
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

      <View style={styles.detailsSectionHeader}>
        <Text style={styles.sectionLabel}>Run history</Text>
        <Text style={styles.muted}>{history.length} {history.length === 1 ? "attempt" : "attempts"}</Text>
      </View>
      {history.length === 0 ? (
        <Text style={styles.muted}>No agents have been linked to this card.</Text>
      ) : (
        <ScrollView style={styles.runHistory}>
          <View style={styles.runHistoryContent}>
            {history.map((run, index) => {
              const agent = agents.find((candidate) => candidate.id === run.agentId);
              const workspace = workspaces.find((candidate) => candidate.id === run.workspaceId);
              const status = runStatus(agent);
              const workspaceName = workspace?.title ?? workspace?.name ?? run.workspaceName;
              const updatedAt = agent?.updatedAt ?? run.updatedAt;
              const attempt = history.length - index;

              return (
                <View key={run.id} style={styles.runRow}>
                  <View style={styles.runHeader}>
                    <Text style={styles.runTitle}>Attempt {attempt}</Text>
                    {index === 0 ? <Text style={styles.reviewCandidate}>Review candidate</Text> : null}
                    <RunStatusBadge
                      color={statusPalette[status.tone]}
                      status={status}
                      textColor={statusTextColor}
                    />
                  </View>
                  <View style={styles.runMetadata}>
                    <Text style={styles.muted}>
                      Profile: {run.agentProfileName ?? agent?.model ?? run.provider}
                    </Text>
                    <Text style={styles.muted}>Workspace: {workspaceName ?? "Unavailable"}</Text>
                    {run.branchName ? <Text style={styles.muted}>Branch: {run.branchName}</Text> : null}
                    <Text style={styles.muted}>Started: {formatTimestamp(run.createdAt)}</Text>
                    <Text style={styles.muted}>Updated: {formatTimestamp(updatedAt)}</Text>
                  </View>
                  {onOpenAgent ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenAgent(run.agentId)}
                      style={styles.button}
                    >
                      <Text style={styles.buttonText}>View Agent</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export interface AgentLauncherState {
  action: "start" | "attach";
  agentProfileId: string | null;
  workspaceMode: "existing" | "new";
  workspaceId: string | null;
  workspaceTitle: string;
  baseRef: string;
  branchName: string;
  attachAgentId: string | null;
  moveAttachedCardToInProgress: boolean;
}

interface AgentLauncherPanelProps {
  agentProfiles: readonly AgentProfile[];
  attachableAgents: readonly AgentSummary[];
  canCreateWorktree: boolean;
  launcher: AgentLauncherState;
  onCancel: () => void;
  onChange: (launcher: AgentLauncherState) => void;
  onStart: () => void;
  placeholderColor: string;
  profileFallbackColor: string;
  profilesSupported: boolean | null;
  showAttachMoveOption: boolean;
  working: boolean;
  styles: BoardStyles;
  workspaces: readonly WorkspaceSummary[];
}

export function AgentLauncherPanel({
  agentProfiles,
  attachableAgents,
  canCreateWorktree,
  launcher,
  onCancel,
  onChange,
  onStart,
  placeholderColor,
  profileFallbackColor,
  profilesSupported,
  showAttachMoveOption,
  working,
  styles,
  workspaces,
}: AgentLauncherPanelProps) {
  const canStart =
    launcher.action === "attach"
      ? Boolean(launcher.attachAgentId)
      : Boolean(
          (launcher.agentProfileId || agentProfiles.length === 0) &&
          (launcher.workspaceMode === "new" ? canCreateWorktree : launcher.workspaceId),
        );

  return (
    <View style={[styles.panel, styles.launcherPanel]}>
      <Text style={styles.launcherTitle}>Run agent</Text>
      <View accessibilityRole="tablist" style={styles.launcherTabs}>
        {(["start", "attach"] as const).map((action) => {
          const selected = launcher.action === action;
          return (
            <Pressable
              key={action}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange({ ...launcher, action })}
              style={[styles.launcherTab, selected && styles.selectedLauncherTab]}
            >
              <Text style={[styles.launcherTabText, selected && styles.selectedLauncherTabText]}>
                {action === "start" ? "Start new" : "Use existing"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {launcher.action === "start" ? (
        <>
          <View style={styles.launcherSection}>
            <Text style={styles.sectionLabel}>1. Choose an agent profile</Text>
            <View accessibilityLabel="Agent profiles" accessibilityRole="radiogroup" style={styles.optionGrid}>
              {agentProfiles.map((profile) => {
                const selected = profile.id === launcher.agentProfileId;
                const color = profileColor(profile.color, profileFallbackColor);
                return (
                  <Pressable
                    key={profile.id}
                    accessibilityLabel={`Agent profile ${profile.name}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChange({ ...launcher, agentProfileId: profile.id })}
                    style={[styles.selectionOption, selected && styles.selectedOption]}
                  >
                    <View style={styles.profileMarker}>
                      <Icon color={color} name={profileIconName(profile.icon)} size={18} />
                    </View>
                    <View style={styles.profileContent}>
                      <Text numberOfLines={1} style={styles.profileName}>{profile.name}</Text>
                      {profile.notes ? (
                        <Text numberOfLines={1} style={styles.muted}>{profile.notes}</Text>
                      ) : null}
                    </View>
                    <ChoiceIndicator selected={selected} styles={styles} />
                  </Pressable>
                );
              })}
            </View>
            {profilesSupported === false ? (
              <Text style={styles.warning}>Agent profiles are unavailable. Paseo will choose an available provider.</Text>
            ) : agentProfiles.length === 0 ? (
              <Text style={styles.muted}>Paseo will choose the default model from the first available provider.</Text>
            ) : null}
          </View>

          <View style={styles.launcherSection}>
            <Text style={styles.sectionLabel}>2. Choose a workspace</Text>
            <View accessibilityRole="tablist" style={styles.launcherTabs}>
              {(["existing", "new"] as const).map((mode) => {
                const selected = launcher.workspaceMode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    disabled={mode === "new" && !canCreateWorktree}
                    onPress={() => onChange({ ...launcher, workspaceMode: mode, workspaceId: null })}
                    style={[styles.launcherTab, selected && styles.selectedLauncherTab]}
                  >
                    <Text style={[styles.launcherTabText, selected && styles.selectedLauncherTabText]}>
                      {mode === "existing" ? "Existing" : "New worktree"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {launcher.workspaceMode === "existing" ? (
              <View accessibilityLabel="Existing workspaces" accessibilityRole="radiogroup" style={styles.optionGrid}>
                {workspaces.map((workspace) => {
                  const selected = workspace.id === launcher.workspaceId;
                  return (
                    <Pressable
                      key={workspace.id}
                      accessibilityLabel={`Workspace ${workspace.name}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => onChange({ ...launcher, workspaceId: workspace.id })}
                      style={[styles.selectionOption, selected && styles.selectedOption]}
                    >
                      <Text numberOfLines={1} style={styles.workspaceName}>
                        {workspace.name}
                      </Text>
                      <ChoiceIndicator selected={selected} styles={styles} />
                    </Pressable>
                  );
                })}
                {workspaces.length === 0 ? (
                  <Text style={styles.warning}>This project has no available workspace.</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.formFields}>
                <TextInput
                  accessibilityLabel="New workspace title"
                  placeholder="Workspace title (optional)"
                  placeholderTextColor={placeholderColor}
                  value={launcher.workspaceTitle}
                  onChangeText={(workspaceTitle) => onChange({ ...launcher, workspaceTitle })}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel="Base branch or ref"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Base branch or ref (optional)"
                  placeholderTextColor={placeholderColor}
                  value={launcher.baseRef}
                  onChangeText={(baseRef) => onChange({ ...launcher, baseRef })}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel="New branch name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="New branch name (optional)"
                  placeholderTextColor={placeholderColor}
                  value={launcher.branchName}
                  onChangeText={(branchName) => onChange({ ...launcher, branchName })}
                  style={styles.input}
                />
                {!canCreateWorktree ? (
                  <Text style={styles.warning}>New worktrees require a Git project.</Text>
                ) : null}
              </View>
            )}
          </View>
        </>
      ) : (
        <View style={styles.launcherSection}>
          <Text style={styles.sectionLabel}>Choose an existing agent</Text>
          <View accessibilityLabel="Unlinked project agents" accessibilityRole="radiogroup" style={styles.optionGrid}>
            {attachableAgents.map((agent) => {
              const selected = agent.id === launcher.attachAgentId;
              const workspace = workspaces.find((candidate) => candidate.id === agent.workspaceId);
              return (
                <Pressable
                  key={agent.id}
                  accessibilityLabel={`Agent ${agent.title ?? agent.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange({ ...launcher, attachAgentId: agent.id })}
                  style={[styles.selectionOption, selected && styles.selectedOption]}
                >
                  <View style={styles.profileContent}>
                    <Text numberOfLines={1} style={styles.profileName}>{agent.title ?? agent.id}</Text>
                    <Text numberOfLines={1} style={styles.muted}>
                      {workspace?.name ?? "Unknown workspace"} · {agent.status}
                    </Text>
                  </View>
                  <ChoiceIndicator selected={selected} styles={styles} />
                </Pressable>
              );
            })}
            {attachableAgents.length === 0 ? (
              <Text style={styles.warning}>No unlinked agents are available in this project.</Text>
            ) : null}
          </View>
          <View style={styles.attachBehavior}>
            {showAttachMoveOption ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: launcher.moveAttachedCardToInProgress }}
                onPress={() => onChange({
                  ...launcher,
                  moveAttachedCardToInProgress: !launcher.moveAttachedCardToInProgress,
                })}
                style={styles.attachBehaviorControl}
              >
                <View style={[
                  styles.checkbox,
                  launcher.moveAttachedCardToInProgress && styles.selectedCheckbox,
                ]}>
                  {launcher.moveAttachedCardToInProgress ? (
                    <Text style={styles.checkboxMark}>✓</Text>
                  ) : null}
                </View>
                <Text style={styles.sectionLabel}>Move card to In Progress</Text>
              </Pressable>
            ) : null}
            <Text style={styles.muted}>
              This links the existing agent and its workspace to the card. No message will be sent.
            </Text>
          </View>
        </View>
      )}

      <View style={[styles.cardActions, styles.launcherFooter]}>
        <Pressable
          accessibilityRole="button"
          disabled={!canStart || working}
          onPress={onStart}
          style={[
            styles.button,
            styles.launcherAction,
            canStart && !working ? styles.primaryButton : styles.disabledLauncherAction,
          ]}
        >
          <Text style={[styles.buttonText, canStart && !working ? styles.primaryButtonText : styles.disabledLauncherActionText]}>
            {working ? "Working…" : launcher.action === "attach" ? "Attach Agent" : "Start Agent"}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.button, styles.launcherAction]}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ImportPanelProps {
  isValidated: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onValidate: () => void;
  placeholderColor: string;
  styles: BoardStyles;
  value: string;
}

export function ImportPanel({
  isValidated,
  onCancel,
  onChange,
  onConfirm,
  onValidate,
  placeholderColor,
  styles,
  value,
}: ImportPanelProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.cardTitle}>Import board backup</Text>
      <Text style={styles.warning}>Import replaces all Kanban data on this host after confirmation.</Text>
      <TextInput
        accessibilityLabel="Board backup JSON"
        multiline
        placeholder="Paste backup JSON"
        placeholderTextColor={placeholderColor}
        value={value}
        onChangeText={onChange}
        style={[styles.input, styles.descriptionInput]}
      />
      <View style={styles.cardActions}>
        <Pressable accessibilityRole="button" onPress={onValidate} style={styles.button}>
          <Text style={styles.buttonText}>Validate</Text>
        </Pressable>
        {isValidated ? (
          <Pressable
            accessibilityRole="button"
            onPress={onConfirm}
            style={[styles.button, styles.dangerButton]}
          >
            <Text style={[styles.buttonText, styles.dangerButtonText]}>Replace board data</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
