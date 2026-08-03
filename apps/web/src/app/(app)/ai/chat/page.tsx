import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getChatConversations } from "../../../_data/loaders";
import { summariseConversations } from "./chat";
import { ConversationsTable } from "./ConversationsTable";
import { StatusFilter } from "./StatusFilter";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { status?: string };
}

export default async function ChatPage({ searchParams }: PageProps) {
  const status = searchParams?.status === "active" || searchParams?.status === "ended"
    ? searchParams.status
    : undefined;
  const { data: conversations, source } = await getChatConversations(status);
  const summary = summariseConversations(conversations);

  return (
    <>
      <PageHeader
        title="Assistant Conversations"
        subtitle="Chat sessions handled by the assistant, with full transcripts."
        back="/ai"
        actions={<a className="btn" href="/ai/governance">Governance</a>}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="💬" iconBg="#e0f2fe" label="Conversations" value={summary.total.toLocaleString("en-IN")} />
        <StatCard icon="🟢" iconBg="#dcfce7" label="Active" value={summary.active.toLocaleString("en-IN")} />
        <StatCard icon="⚪" iconBg="#f1f5f9" label="Ended" value={summary.ended.toLocaleString("en-IN")} />
      </StatGrid>

      <StatusFilter />

      <Card title="Conversations">
        <ConversationsTable conversations={conversations} />
      </Card>
    </>
  );
}
