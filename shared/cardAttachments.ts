import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { BOARD_COLUMN_LABELS, type BoardData } from "./model";

const CardAttachmentItemSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.string().url(),
  text: z.string(),
  resourceType: z.string(),
});

export const searchKanbanCards = defineRpc({
  name: "kanban.cards.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(CardAttachmentItemSchema) }),
});

export const kanbanCardsAttachmentSource = defineAttachmentSource({
  id: "kanban-cards",
  title: "Kanban card",
  icon: "Columns3",
  pickerTitle: "Attach a Kanban card",
  searchPlaceholder: "Search by key, title, or description",
  search: searchKanbanCards,
});

export function findCardAttachments(data: BoardData, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const boardsById = new Map(data.boards.map((board) => [board.id, board]));

  return data.cards
    .filter((card) => {
      if (!normalizedQuery) return true;
      return `${card.key} ${card.title} ${card.description}`
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 50)
    .map((card) => {
      const board = boardsById.get(card.boardId);
      const description = card.description.trim();
      return {
        id: card.id,
        identifier: card.key,
        title: card.title,
        subtitle: `${board?.name ?? "Kanban"} · ${BOARD_COLUMN_LABELS[card.column]}`,
        url: `paseo://kanban/card/${encodeURIComponent(card.id)}`,
        text: [
          `# ${card.key}: ${card.title}`,
          `Status: ${BOARD_COLUMN_LABELS[card.column]}`,
          description ? `\n${description}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        resourceType: "kanban-card",
      };
    });
}
