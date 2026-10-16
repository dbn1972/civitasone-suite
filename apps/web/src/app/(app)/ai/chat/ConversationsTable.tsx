"use client";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { ChatConversation } from "@civitasone/types";
import { formatDuration, formatInIST } from "@/lib/formatters";
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
  return formatInIST(iso, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// GAP-AI-CHAT-02: a short, recognisable reference for a conversation UUID. The
// full id stays in the row link (rowHref) and the cell's title attribute; the
// operator sees a short token rather than a 36-char UUID.
function shortRef(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function ConversationsTable({ conversations }: { conversations: ChatConversation[] }) {
  const t = useTranslations("aiChat");

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
      queue: isHandedOff ? (conversation.handoffQueue ?? t("table.unrouted")) : "—",
      // GAP-AI-CHAT-04: how long a handed-off conversation has been waiting for
      // an operator (elapsed since handedOffAt). "—" for non-handed rows.
      waiting:
        isHandedOff && conversation.handedOffAt
          ? t("table.waitingLabel", { duration: formatDuration(conversation.handedOffAt) })
          : "—",
      language: conversation.language.toUpperCase(),
      handoff: handoffReasonLabel(conversation.handoffReason) ?? "—",
      duration: minutes === null ? t("table.inProgress") : t("table.durationMin", { minutes: minutes.toLocaleString("en-IN") }),
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
        { key: "ref", label: t("table.colConversation"), render: (row) => <span className="mono" title={row.id}>{row.ref}</span> },
        { key: "status", label: t("table.colStatus"), render: (row) => <StatusPill status={row.status} /> },
        { key: "queue", label: t("table.colQueue") },
        { key: "waiting", label: t("table.colWaiting"), render: (row) => (row.waiting === "—" ? "—" : <StatusPill status="pending" label={row.waiting} />) },
        { key: "language", label: t("table.colLanguage") },
        { key: "handoff", label: t("table.colHandoffReason") },
        { key: "duration", label: t("table.colDuration"), align: "right" },
        { key: "startedAt", label: t("table.colStarted") },
      ]}
      rows={rows}
      rowHref={(row) => `/ai/chat/${row.id}`}
      sortable
      filterable
      filterPlaceholder={t("table.filterPlaceholder")}
      pageSize={20}
      emptyIcon="💬"
      emptyTitle={t("table.emptyTitle")}
      emptyMessage={t("table.emptyMessage")}
    />
  );
}
