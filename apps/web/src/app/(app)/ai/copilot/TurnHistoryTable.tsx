"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { CopilotTurn } from "@civitasone/types";
import { citationCount, truncatePrompt, turnState } from "./copilot";

type TurnRow = {
  id: string;
  prompt: string;
  state: string;
  model: string;
  tokens: string;
  latency: string;
  citations: number;
  askedAt: string;
};

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TurnHistoryTable({ turns }: { turns: CopilotTurn[] }) {
  const rows: TurnRow[] = turns.map((turn) => ({
    id: turn.id,
    prompt: truncatePrompt(turn.prompt),
    state: turnState(turn) === "answered" ? "Answered" : "Awaiting",
    model: turn.model ?? "—",
    tokens: turn.tokens === null ? "—" : turn.tokens.toLocaleString("en-IN"),
    latency: turn.latencyMs === null ? "—" : `${turn.latencyMs.toLocaleString("en-IN")} ms`,
    citations: citationCount(turn),
    askedAt: formatDateTime(turn.createdAt),
  }));

  return (
    <DataTable<TurnRow>
      columns={[
        { key: "prompt", label: "Prompt" },
        { key: "state", label: "State", render: (row) => <StatusPill status={row.state} /> },
        { key: "model", label: "Model" },
        { key: "tokens", label: "Tokens", align: "right" },
        { key: "latency", label: "Latency", align: "right" },
        { key: "citations", label: "Sources", align: "right" },
        { key: "askedAt", label: "Asked" },
      ]}
      rows={rows}
      rowHref={(row) => `/ai/copilot/${row.id}`}
      sortable
      filterable
      filterPlaceholder="Filter prompts…"
      pageSize={20}
      emptyIcon="💬"
      emptyTitle="No copilot turns yet"
      emptyMessage="Ask the copilot a question above and the turn will be recorded here with its sources and latency."
    />
  );
}
