import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, TextInput, View } from "react-native";
import type { AgentProfile } from "../shared/agentProfiles";
import { BOARD_COLUMNS, BOARD_COLUMN_LABELS, type BoardColumn } from "../shared/model";
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

function profileColor(color: string | undefined): string {
  if (!color) return "#64748b";
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
  return (
    <View style={styles.panel}>
      <Text style={styles.cardTitle}>{editor.mode === "create" ? "Create card" : "Edit card"}</Text>
      <TextInput
        accessibilityLabel="Card title"
        placeholder="Title"
        placeholderTextColor={placeholderColor}
        value={editor.title}
        onChangeText={(title) => onChange({ ...editor, title })}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Card description"
        multiline
        placeholder="Description"
        placeholderTextColor={placeholderColor}
        value={editor.description}
        onChangeText={(description) => onChange({ ...editor, description })}
        style={[styles.input, styles.descriptionInput]}
      />
      {editor.mode === "create" ? (
        <View style={styles.toolbar}>
          {BOARD_COLUMNS.map((column) => {
            const selected = editor.column === column;
            return (
              <Pressable
                key={column}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...editor, column })}
                style={[styles.chip, selected && styles.selectedChip]}
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
          disabled={!editor.title.trim() || saving}
          onPress={onSave}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={[styles.buttonText, styles.primaryButtonText]}>Save</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
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
  profilesSupported: boolean | null;
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
  profilesSupported,
  working,
  styles,
  workspaces,
}: AgentLauncherPanelProps) {
  const canStart =
    launcher.action === "attach"
      ? Boolean(launcher.attachAgentId)
      : Boolean(
          launcher.agentProfileId &&
            (launcher.workspaceMode === "new" ? canCreateWorktree : launcher.workspaceId),
        );

  return (
    <View style={styles.panel}>
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
          <Text style={styles.sectionLabel}>1. CHOOSE AN AGENT PROFILE</Text>
          <View accessibilityLabel="Agent profiles" accessibilityRole="radiogroup" style={styles.optionGrid}>
            {agentProfiles.map((profile) => {
              const selected = profile.id === launcher.agentProfileId;
              const color = profileColor(profile.color);
              return (
                <Pressable
                  key={profile.id}
                  accessibilityLabel={`Agent profile ${profile.name}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange({ ...launcher, agentProfileId: profile.id })}
                  style={[
                    styles.profileOption,
                    selected && styles.selectedOption,
                  ]}
                >
                  <View style={[styles.profileMarker, { backgroundColor: color }]}>
                    <Icon color="#ffffff" name={profileIconName(profile.icon)} size={16} />
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
            <Text style={styles.warning}>This Paseo host does not support agent profiles.</Text>
          ) : agentProfiles.length === 0 ? (
            <Text style={styles.warning}>No agent profiles are configured on this host.</Text>
          ) : null}

          <Text style={styles.sectionLabel}>2. CHOOSE A WORKSPACE</Text>
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
                    accessibilityLabel={`Workspace ${workspace.title ?? workspace.name}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChange({ ...launcher, workspaceId: workspace.id })}
                    style={[styles.workspaceOption, selected && styles.selectedOption]}
                  >
                    <Text numberOfLines={1} style={styles.workspaceName}>
                      {workspace.title ?? workspace.name}
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
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>CHOOSE AN EXISTING AGENT</Text>
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
                  style={[styles.profileOption, styles.attachOption, selected && styles.selectedOption]}
                >
                  <View style={styles.profileContent}>
                    <Text numberOfLines={1} style={styles.profileName}>{agent.title ?? agent.id}</Text>
                    <Text numberOfLines={1} style={styles.muted}>
                      {workspace?.title ?? workspace?.name ?? "Unknown workspace"} · {agent.status}
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
        </>
      )}

      <View style={styles.cardActions}>
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
            {working ? "Working…" : launcher.action === "attach" ? "Attach agent" : "Start agent"}
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
