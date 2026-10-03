import { Pressable, Text, TextInput, View } from "react-native";
import { BOARD_COLUMNS, BOARD_COLUMN_LABELS, type BoardColumn } from "../shared/model";
import type { BoardStyles } from "./useBoardStyles";
import type { ModelChoice, WorkspaceSummary } from "./usePaseoDirectory";

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

interface AgentLauncherPanelProps {
  models: readonly ModelChoice[];
  onCancel: () => void;
  onModelChange: (model: string) => void;
  onStart: () => void;
  onWorkspaceChange: (workspaceId: string) => void;
  providerModel: string | null;
  starting: boolean;
  styles: BoardStyles;
  workspaceId: string | null;
  workspaces: readonly WorkspaceSummary[];
}

export function AgentLauncherPanel({
  models,
  onCancel,
  onModelChange,
  onStart,
  onWorkspaceChange,
  providerModel,
  starting,
  styles,
  workspaceId,
  workspaces,
}: AgentLauncherPanelProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.cardTitle}>Start agent</Text>
      <Text style={styles.sectionLabel}>WORKSPACE</Text>
      <View style={styles.toolbar}>
        {workspaces.map((workspace) => {
          const selected = workspace.id === workspaceId;
          return (
            <Pressable
              key={workspace.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onWorkspaceChange(workspace.id)}
              style={[styles.chip, selected && styles.selectedChip]}
            >
              <Text style={[styles.buttonText, selected && styles.selectedChipText]}>
                {workspace.title ?? workspace.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.sectionLabel}>PROVIDER AND MODEL</Text>
      <View style={styles.toolbar}>
        {models.map((model) => {
          const selected = model.id === providerModel;
          return (
            <Pressable
              key={model.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onModelChange(model.id)}
              style={[styles.chip, selected && styles.selectedChip]}
            >
              <Text style={[styles.buttonText, selected && styles.selectedChipText]}>{model.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {workspaces.length === 0 ? (
        <Text style={styles.warning}>This project has no available workspace.</Text>
      ) : null}
      {models.length === 0 ? (
        <Text style={styles.warning}>No ready provider model is available.</Text>
      ) : null}
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          disabled={!workspaceId || !providerModel || starting}
          onPress={onStart}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={[styles.buttonText, styles.primaryButtonText]}>
            {starting ? "Starting…" : "Start"}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
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
