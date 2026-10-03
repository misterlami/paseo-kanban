import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { BoardStyles } from "./useBoardStyles";
import type { ProjectSummary } from "./usePaseoDirectory";

interface ProjectPickerProps {
  filter: string;
  foregroundMuted: string;
  onFilterChange: (value: string) => void;
  onSelect: (projectId: string) => void;
  onToggle: () => void;
  open: boolean;
  projects: readonly ProjectSummary[];
  selectedProjectId: string | null;
  styles: BoardStyles;
}

export function ProjectPicker({
  filter,
  foregroundMuted,
  onFilterChange,
  onSelect,
  onToggle,
  open,
  projects,
  selectedProjectId,
  styles,
}: ProjectPickerProps) {
  const selectedProject = projects.find((project) => project.projectId === selectedProjectId);
  const visibleProjects = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    return projects
      .filter(
        (project) =>
          !normalizedFilter || project.projectDisplayName.toLowerCase().includes(normalizedFilter),
      )
      .sort(
        (left, right) =>
          Number(right.projectId === selectedProjectId) - Number(left.projectId === selectedProjectId) ||
          left.projectDisplayName.localeCompare(right.projectDisplayName),
      );
  }, [filter, projects, selectedProjectId]);

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.heading}>Kanban</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select project"
          accessibilityState={{ expanded: open }}
          disabled={projects.length === 0}
          onPress={onToggle}
          style={styles.projectButton}
        >
          <Text style={styles.projectButtonLabel}>PROJECT</Text>
          <Text numberOfLines={1} style={styles.projectButtonText}>
            {selectedProject?.projectDisplayName ?? "Select a project"}
          </Text>
          <Text style={styles.projectButtonChevron}>{open ? "▲" : "▼"}</Text>
        </Pressable>
      </View>

      {open ? (
        <View style={styles.projectPicker}>
          <TextInput
            accessibilityLabel="Filter projects"
            autoFocus
            placeholder={`Filter ${projects.length} projects`}
            placeholderTextColor={foregroundMuted}
            value={filter}
            onChangeText={onFilterChange}
            style={styles.input}
          />
          <ScrollView style={styles.projectList} contentContainerStyle={styles.projectOptions}>
            {visibleProjects.map((project) => {
              const selected = project.projectId === selectedProjectId;
              return (
                <Pressable
                  key={project.projectId}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(project.projectId)}
                  style={[styles.projectOption, selected && styles.selectedProjectOption]}
                >
                  <Text style={styles.projectOptionText}>{project.projectDisplayName}</Text>
                </Pressable>
              );
            })}
            {visibleProjects.length === 0 ? (
              <Text style={styles.muted}>No matching projects.</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </>
  );
}
