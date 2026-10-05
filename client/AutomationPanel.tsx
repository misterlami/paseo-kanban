import { Pressable, Text, TextInput, View } from "react-native";
import type { AgentProfile } from "../shared/agentProfiles";
import type { AutomationSettings } from "../shared/model";
import type { BoardStyles } from "./useBoardStyles";

interface AutomationPanelProps {
  agentProfiles: readonly AgentProfile[];
  draft: AutomationSettings;
  onCancel: () => void;
  onChange: (draft: AutomationSettings) => void;
  onSave: () => void;
  placeholderColor: string;
  saving: boolean;
  styles: BoardStyles;
}

export function AutomationPanel({
  agentProfiles,
  draft,
  onCancel,
  onChange,
  onSave,
  placeholderColor,
  saving,
  styles,
}: AutomationPanelProps) {
  const selectedProfile = agentProfiles.find((profile) => profile.id === draft.agentProfileId);
  const outcome = draft.lastOutcome?.replace("_", " ") ?? "Never run";

  return (
    <View style={styles.panel}>
      <View style={styles.detailsHeader}>
        <View style={styles.detailsHeading}>
          <Text style={styles.launcherTitle}>Daily Ready-card dispatcher</Text>
          <Text style={styles.muted}>
            Claims one eligible Ready card, creates a worktree, starts an agent, and moves the card to In Progress.
          </Text>
          <Text style={styles.warning}>Runs only while a Paseo app is connected to this host.</Text>
        </View>
      </View>

      <View style={styles.formFields}>
        <Text style={styles.sectionLabel}>Schedule</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: draft.enabled }}
          onPress={() => onChange({ ...draft, enabled: !draft.enabled })}
          style={[styles.button, draft.enabled && styles.selectedChip]}
        >
          <Text style={[styles.buttonText, draft.enabled && styles.selectedChipText]}>
            {draft.enabled ? "Enabled" : "Disabled"}
          </Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Daily dispatch time"
          placeholder="09:00"
          placeholderTextColor={placeholderColor}
          value={draft.dailyTime}
          onChangeText={(dailyTime) => onChange({ ...draft, dailyTime })}
          style={styles.input}
        />
        <Text style={styles.muted}>
          24-hour time in {draft.timezone ?? "the device's local timezone"}.
        </Text>

        <Text style={styles.sectionLabel}>Agent profile</Text>
        <View style={styles.optionGrid}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: !selectedProfile }}
            onPress={() => onChange({ ...draft, agentProfileId: null })}
            style={[styles.chip, !selectedProfile && styles.selectedChip]}
          >
            <Text style={[styles.buttonText, !selectedProfile && styles.selectedChipText]}>
              Automatic provider
            </Text>
          </Pressable>
          {agentProfiles.map((profile) => {
            const selected = profile.id === selectedProfile?.id;
            return (
              <Pressable
                key={profile.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...draft, agentProfileId: profile.id })}
                style={[styles.chip, selected && styles.selectedChip]}
              >
                <Text style={[styles.buttonText, selected && styles.selectedChipText]}>{profile.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {agentProfiles.length === 0 ? (
          <Text style={styles.muted}>Uses the default model from the first available provider.</Text>
        ) : null}

        <Text style={styles.sectionLabel}>Worktree base</Text>
        <TextInput
          accessibilityLabel="Worktree base reference"
          placeholder="origin/main"
          placeholderTextColor={placeholderColor}
          value={draft.baseRef}
          onChangeText={(baseRef) => onChange({ ...draft, baseRef })}
          style={styles.input}
        />

        <Text style={styles.sectionLabel}>Maximum concurrent Kanban agents</Text>
        <TextInput
          accessibilityLabel="Maximum concurrent Kanban agents"
          inputMode="numeric"
          value={String(draft.maxConcurrent)}
          onChangeText={(value) => {
            const parsed = Number.parseInt(value, 10);
            onChange({ ...draft, maxConcurrent: Number.isFinite(parsed) ? parsed : 1 });
          }}
          style={styles.input}
        />
      </View>

      <Text style={styles.muted}>Last result: {outcome}{draft.lastMessage ? ` · ${draft.lastMessage}` : ""}</Text>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={onSave} style={[styles.button, styles.primaryButton]}>
          <Text style={[styles.buttonText, styles.primaryButtonText]}>{saving ? "Saving…" : "Save automation"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving} onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
