"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { ChatConversation } from "@civitasone/types";
import { formatDuration } from "@/lib/formatters";
import { conversationDurationMinutes, handoffReasonLabel, statusLabel } from "./chat";

type ConversationRow = {
  id: string;
  ref: string;
  status: string;
  rawStatus: string;
  queue: string;
  waiting: string;
  language: string;
  handoff: string;
  duration: string;
  startedAt: string;
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

// GAP-AI-CHAT-02: a short, recognisable reference for a conversation UUID. The
// full id stays in the row link (rowHref) and the cell's title attribute; the
// operator sees a short token rather than a 36-char UUID.
function shortRef(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function ConversationsTable({ conversations }: { conversations: ChatConversation[] }) {
  const rows: ConversationRow[] = conversations.map((conversation) => {
    const minutes = conversationDurationMinutes(conversation);
    const isHandedOff = conversation.status === "handed_off";
    return {
      id: conversation.id,
      ref: shortRef(conversation.id),
      status: statusLabel(conversation.status),
      rawStatus: conversation.status,
      // GAP-AI-CHAT-04: show the routing queue for a handed-off conversation,
      // "Unrouted" when it was handed off without one, "—" otherwise.
      queue: isHandedOff ? (conversation.handoffQueue ?? "Unrouted") : "—",
      // GAP-AI-CHAT-04: how long a handed-off conversation has been waiting for
      // an operator (elapsed since handedOffAt). "—" for non-handed rows.
      waiting:
        isHandedOff && conversation.handedOffAt
          ? `Waiting ${formatDuration(conversation.handedOffAt)}`
          : "—",
      language: conversation.language.toUpperCase(),
      handoff: handoffReasonLabel(conversation.handoffReason) ?? "—",
      duration: minutes === null ? "In progress" : `${minutes.toLocaleString("en-IN")} min`,
      startedAt: formatDateTime(conversation.startedAt),
    };
  });

  // GAP-AI-CHAT-04: surface conversations waiting with a human agent first so an
  // operator sees what needs attention before closed/active chats.
  const order: Record<string, number> = { handed_off: 0, active: 1, ended: 2 };
  rows.sort((a, b) => (order[a.rawStatus] ?? 3) - (order[b.rawStatus] ?? 3));

  return (
    <DataTable<ConversationRow>
      columns={[
        { key: "ref", label: "Conversation", render: (row) => <span className="mono" title={row.id}>{row.ref}</span> },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
        { key: "queue", label: "Queue" },
        { key: "waiting", label: "Waiting", render: (row) => (row.waiting === "—" ? "—" : <StatusPill status="pending" label={row.waiting} />) },
        { key: "language", label: "Language" },
        { key: "handoff", label: "Handoff reason" },
        { key: "duration", label: "Duration", align: "right" },
        { key: "startedAt", label: "Started" },
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
