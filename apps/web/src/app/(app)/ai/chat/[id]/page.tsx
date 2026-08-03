import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../../_components/ds";
import { getChatConversation, getChatTranscript } from "../../../../_data/loaders";
import { conversationDurationMinutes, inReadingOrder, roleLabel, summariseTranscript } from "../chat";
import { EndConversationButton } from "./EndConversationButton";

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
          icon={isActive ? "🟢" : "⚪"}
          iconBg={isActive ? "#dcfce7" : "#f1f5f9"}
          label="Status"
          value={isActive ? "Active" : "Ended"}
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
        <EndConversationButton conversationId={conversation.id} version={conversation.version} />
      )}
    </>
  );
}
