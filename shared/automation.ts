import type { AutomationSettings, BoardData, Card, Run } from "./model";

export interface LocalClock {
  date: string;
  time: string;
}

export function localClock(now: Date, timezone: string | null): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    ...(timezone ? { timeZone: timezone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = new Map(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
    time: `${parts.get("hour")}:${parts.get("minute")}`,
  };
}

export function dailyDispatchDue(
  settings: AutomationSettings,
  now: Date,
): { date: string; due: boolean } {
  const clock = localClock(now, settings.timezone);
  const leaseActive = Boolean(
    settings.leaseId &&
      settings.leaseLocalDate === clock.date &&
      settings.leaseExpiresAt &&
      settings.leaseExpiresAt > now.toISOString(),
  );
  return {
    date: clock.date,
    due:
      settings.enabled &&
      clock.time >= settings.dailyTime &&
      settings.lastRunLocalDate !== clock.date &&
      !leaseActive,
  };
}

export function scheduledRunForDate(data: BoardData, localDate: string): Run | undefined {
  return data.runs.find((run) => run.scheduledLocalDate === localDate);
}

export function dispatchBranchName(card: Pick<Card, "key" | "title">, claimId: string): string {
  const slug = card.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
    .replace(/-$/g, "") || "work";
  const suffix = claimId.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
  return `codex/${card.key.toLowerCase()}-${slug}-${suffix}`;
}

export function agentPrompt(card: Pick<Card, "key" | "title" | "description">): string {
  return [
    `Work on ${card.key}: ${card.title}.`,
    card.description,
    "Read and follow the repository instructions. Implement the requested work, verify it, and report the result and any remaining work.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
