"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { ChatConversation } from "@civitasone/types";
import { conversationDurationMinutes, handoffReasonLabel, statusLabel } from "./chat";

type ConversationRow = {
  id: string;
  status: string;
  language: string;
  handoff: string;
  duration: string;
  startedAt: string;
  endedAt: string;
};

function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationsTable({ conversations }: { conversations: ChatConversation[] }) {
  const rows: ConversationRow[] = conversations.map((conversation) => {
    const minutes = conversationDurationMinutes(conversation);
    return {
      id: conversation.id,
      status: statusLabel(conversation.status),
      language: conversation.language.toUpperCase(),
      handoff: handoffReasonLabel(conversation.handoffReason) ?? "—",
      duration: minutes === null ? "In progress" : `${minutes.toLocaleString("en-IN")} min`,
      startedAt: formatDateTime(conversation.startedAt),
      endedAt: formatDateTime(conversation.endedAt),
    };
  });

  return (
    <DataTable<ConversationRow>
      columns={[
        { key: "id", label: "Conversation" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
        { key: "language", label: "Language" },
        { key: "handoff", label: "Handoff reason" },
        { key: "duration", label: "Duration", align: "right" },
        { key: "startedAt", label: "Started" },
        { key: "endedAt", label: "Ended" },
      ]}
      rows={rows}
      rowHref={(row) => `/ai/chat/${row.id}`}
      sortable
      filterable
      filterPlaceholder="Filter conversations…"
      pageSize={20}
      emptyIcon="💬"
      emptyTitle="No conversations yet"
      emptyMessage="Chat conversations started through any channel appear here with their full transcript."
    />
  );
}
