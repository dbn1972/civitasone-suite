import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getChatConversations, getChatConversationCounts } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { ConversationsTable } from "./ConversationsTable";
import { StatusFilter } from "./StatusFilter";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: Promise<{ status?: string }>;
}

export default async function ChatPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("aiChat");
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
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        back="/ai"
        actions={<Link className="btn" href="/ai/governance">{t("page.governanceLink")}</Link>}
      />
      <StatGrid>
        <StatCard icon="💬" iconBg="var(--infobg)" label={t("stats.conversations")} value={fmt(counts?.total)} />
        <StatCard icon="🟢" iconBg="var(--goodbg)" label={t("stats.active")} value={fmt(counts?.active)} />
        <StatCard icon="🙋" iconBg="var(--warnbg)" label={t("stats.withAgent")} value={fmt(counts?.handedOff)} />
        <StatCard icon="⚪" iconBg="var(--line2)" label={t("stats.ended")} value={fmt(counts?.ended)} />
      </StatGrid>

      <StatusFilter />

      {/* GAP-AI-CHAT-01: a failed fetch must not read as "no conversations yet".
          Show a retry state in place of the table; the StatusFilter stays above
          so an operator can retry with another filter. */}
      {source === "error" ? (
        <Card title={t("page.conversationsCard")}>
          <RefreshErrorState error={toHumanError("load", { area: "conversations" })} />
        </Card>
      ) : (
        <Card title={t("page.conversationsCard")}>
          <ConversationsTable conversations={conversations} />
        </Card>
      )}
    </>
  );
}
