import Link from "next/link";
import { Card, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getChatConversations, getChatConversationCounts } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { ConversationsTable } from "./ConversationsTable";
import { StatusFilter } from "./StatusFilter";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { status?: string };
}

export default async function ChatPage({ searchParams }: PageProps) {
  const requested = searchParams?.status;
  const status = requested === "active" || requested === "handed_off" || requested === "ended"
    ? requested
    : undefined;
  const [{ data: conversations, source }, { data: counts }] = await Promise.all([
    getChatConversations(status),
    getChatConversationCounts(),
  ]);

  // GAP-AI-CHAT-03: stat cards read accurate server-side counts (meta.total),
  // not the length of one fetched page. "—" when the counts call failed, so a
  // count outage is never shown as a reassuring 0.
  const dash = "—";
  const fmt = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN") : dash);

  return (
    <>
      <PageHeader
        title="Assistant Conversations"
        subtitle="Chat sessions handled by the assistant, with full transcripts."
        back="/ai"
        actions={<Link className="btn" href="/ai/governance">Governance</Link>}
      />
      <StatGrid>
        <StatCard icon="💬" iconBg="var(--infobg)" label="Conversations" value={fmt(counts?.total)} />
        <StatCard icon="🟢" iconBg="var(--goodbg)" label="Active" value={fmt(counts?.active)} />
        <StatCard icon="🙋" iconBg="var(--warnbg)" label="With agent" value={fmt(counts?.handedOff)} />
        <StatCard icon="⚪" iconBg="var(--line2)" label="Ended" value={fmt(counts?.ended)} />
      </StatGrid>

      <StatusFilter />

      {/* GAP-AI-CHAT-01: a failed fetch must not read as "no conversations yet".
          Show a retry state in place of the table; the StatusFilter stays above
          so an operator can retry with another filter. */}
      {source === "error" ? (
        <Card title="Conversations">
          <RefreshErrorState error={toHumanError("load", { area: "conversations" })} />
        </Card>
      ) : (
        <Card title="Conversations">
          <ConversationsTable conversations={conversations} />
        </Card>
      )}
    </>
  );
}
