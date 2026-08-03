import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../../_components/ds";
import { getChatConversation, getChatTranscript } from "../../../../_data/loaders";
import {
  conversationDurationMinutes,
  handoffReasonLabel,
  inReadingOrder,
  roleLabel,
  statusLabel,
  summariseTranscript,
} from "../chat";
import { EndConversationButton } from "./EndConversationButton";
import { HandoffButton } from "./HandoffButton";

interface PageProps {
  params: { id: string };
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ChatConversationPage({ params }: PageProps) {
  const [{ data: conversation, source: conversationSource }, { data: messages, source: transcriptSource }] =
    await Promise.all([getChatConversation(params.id), getChatTranscript(params.id)]);

  if (!conversation) {
    return (
      <>
        <PageHeader title="Conversation" back="/ai/chat" />
        {conversationSource === "error" && <DataSourceBadge source={conversationSource} />}
        <Card>
          <EmptyState
            icon="💬"
            title="Conversation not found"
            message="This conversation does not exist, or it belongs to another tenant."
            action={<a className="btn" href="/ai/chat">Back to conversations</a>}
          />
        </Card>
      </>
    );
  }

  const source = conversationSource === "error" || transcriptSource === "error" ? "error" : "api";
  const ordered = inReadingOrder(messages);
  const stats = summariseTranscript(messages);
  const minutes = conversationDurationMinutes(conversation);
  const isActive = conversation.status === "active";
  const isHandedOff = conversation.status === "handed_off";
  const statusIcon = isActive ? "🟢" : isHandedOff ? "🙋" : "⚪";
  const statusIconBg = isActive ? "#dcfce7" : isHandedOff ? "#fef3c7" : "#f1f5f9";

  return (
    <>
      <PageHeader
        title="Conversation"
        subtitle={`Started ${formatDateTime(conversation.startedAt)}`}
        back="/ai/chat"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard
          icon={statusIcon}
          iconBg={statusIconBg}
          label="Status"
          value={statusLabel(conversation.status)}
        />
        <StatCard icon="💬" iconBg="#e0f2fe" label="Messages" value={stats.messages.toLocaleString("en-IN")} />
        <StatCard
          icon="⏱️"
          iconBg="#fef3c7"
          label="Duration"
          value={minutes === null ? "In progress" : `${minutes.toLocaleString("en-IN")} min`}
        />
        <StatCard icon="🔢" iconBg="#fce7f3" label="Tokens" value={stats.totalTokens.toLocaleString("en-IN")} />
      </StatGrid>

      {isHandedOff || conversation.handedOffAt !== null ? (
        <Card title="Handed to a human agent">
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 16px", padding: "12px 16px", margin: 0 }}>
            <dt style={{ fontSize: 13, color: "#475569" }}>Reason</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>
              {handoffReasonLabel(conversation.handoffReason) ?? "Not recorded"}
            </dd>
            <dt style={{ fontSize: 13, color: "#475569" }}>Handed off at</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{formatDateTime(conversation.handedOffAt)}</dd>
            <dt style={{ fontSize: 13, color: "#475569" }}>Queue</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{conversation.handoffQueue ?? "Unrouted"}</dd>
            <dt style={{ fontSize: 13, color: "#475569" }}>Note</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{conversation.handoffNote ?? "—"}</dd>
          </dl>
        </Card>
      ) : null}

      <Card title="Transcript">
        {ordered.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No messages yet"
            message="This conversation was started but no message has been recorded against it."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "12px 16px" }}>
            {ordered.map((entry) => (
              <li key={entry.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <StatusPill status={roleLabel(entry.role)} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>{formatDateTime(entry.createdAt)}</span>
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{entry.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isActive && (
        <HandoffButton conversationId={conversation.id} version={conversation.version} />
      )}

      {(isActive || isHandedOff) && (
        <EndConversationButton conversationId={conversation.id} version={conversation.version} />
      )}
    </>
  );
}
