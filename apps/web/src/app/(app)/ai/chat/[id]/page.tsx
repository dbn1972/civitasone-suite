import { formatIndianDateTime } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusPill, RefreshErrorState } from "../../../../_components/ds";
import { getChatConversation, getChatTranscript } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, AI_CHAT_READ_ROLES } from "@/lib/auth/roleGuard";
import { redirect } from "next/navigation";
import { maskIdentifiers } from "@/lib/pii";
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
  params: Promise<{ id: string }>;
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  if (Number.isNaN(new Date(iso).getTime())) return "—";
  return formatIndianDateTime(iso);
}

export default async function ChatConversationPage(props: PageProps) {
  const params = await props.params;
  // GAP-AI-CHAT-DETAIL-02 / -04: citizen transcripts carry DPDP-sensitive text,
  // so only AI operators (ai_user/ai_admin/super_admin — ai-agent-service's
  // READ_ROLES) may open a conversation. A role outside the set is redirected
  // rather than shown the page; the service also 403s every read, so this is
  // defence-in-depth, not the only gate.
  if (!hasAnyRole(getSessionRoles(), AI_CHAT_READ_ROLES)) {
    redirect("/ai");
  }

  const t = await getTranslations("aiChat");

  const [{ data: conversation, source: conversationSource }, { data: messages, source: transcriptSource }] =
    await Promise.all([getChatConversation(params.id), getChatTranscript(params.id)]);

  // GAP-AI-CHAT-DETAIL-05: a service outage must not read as "not found". When
  // the conversation fetch itself errored (as opposed to a tenant-scoped 404,
  // which the loader maps to source "api" + data null), show a retry state.
  if (conversationSource === "error") {
    return (
      <>
        <PageHeader title={t("detail.statStatus")} back="/ai/chat" />
        <Card>
          <RefreshErrorState error={toHumanError("load", { area: "conversation" })} />
        </Card>
      </>
    );
  }

  if (!conversation) {
    return (
      <>
        <PageHeader title={t("detail.statStatus")} back="/ai/chat" />
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

  // GAP-AI-CHAT-DETAIL-05: the conversation loaded; only the transcript may
  // still have errored. Keep Status/Duration (from the conversation) honest and
  // show "—" for the transcript-derived Messages/Tokens on a transcript outage,
  // rather than a reassuring 0.
  const transcriptErrored = transcriptSource === "error";
  const ordered = inReadingOrder(messages);
  const stats = summariseTranscript(messages);
  const minutes = conversationDurationMinutes(conversation);
  const isActive = conversation.status === "active";
  const isHandedOff = conversation.status === "handed_off";
  const statusIcon = isActive ? "🟢" : isHandedOff ? "🙋" : "⚪";
  const statusIconBg = isActive ? "var(--goodbg)" : isHandedOff ? "var(--warnbg)" : "var(--line2)";

  return (
    <>
      <PageHeader
        title={t("detail.statStatus")}
        subtitle={`${t("detail.statStarted")} ${formatDateTime(conversation.startedAt)}`}
        back="/ai/chat"
      />
      <StatGrid>
        <StatCard
          icon={statusIcon}
          iconBg={statusIconBg}
          label={t("detail.statStatus")}
          value={statusLabel(conversation.status)}
        />
        <StatCard icon="💬" iconBg="var(--infobg)" label={t("detail.statMessages")} value={transcriptErrored ? "—" : stats.messages.toLocaleString("en-IN")} />
        <StatCard
          icon="⏱️"
          iconBg="var(--warnbg)"
          label={t("detail.statDuration")}
          value={minutes === null ? t("table.inProgress") : t("table.durationMin", { minutes: minutes.toLocaleString("en-IN") })}
        />
        <StatCard icon="🔢" iconBg="var(--infobg)" label={t("detail.statTokens")} value={transcriptErrored ? "—" : stats.totalTokens.toLocaleString("en-IN")} />
      </StatGrid>

      {isHandedOff || conversation.handedOffAt !== null ? (
        <Card title={t("detail.sectionHandedToAgent")}>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 16px", padding: "12px 16px", margin: 0 }}>
            <dt style={{ fontSize: 13, color: "var(--muted)" }}>Reason</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>
              {handoffReasonLabel(conversation.handoffReason) ?? "Not recorded"}
            </dd>
            <dt style={{ fontSize: 13, color: "var(--muted)" }}>{t("detail.statHandedOff")}</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{formatDateTime(conversation.handedOffAt)}</dd>
            <dt style={{ fontSize: 13, color: "var(--muted)" }}>Queue</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{conversation.handoffQueue ?? t("table.unrouted")}</dd>
            <dt style={{ fontSize: 13, color: "var(--muted)" }}>Note</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{conversation.handoffNote ?? "—"}</dd>
          </dl>
        </Card>
      ) : null}

      <Card title={t("detail.sectionTranscript")}>
        {transcriptErrored ? (
          <RefreshErrorState error={toHumanError("load", { area: "conversation transcript" })} />
        ) : ordered.length === 0 ? (
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
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatDateTime(entry.createdAt)}</span>
                </div>
                {/* GAP-AI-CHAT-DETAIL-02 (DPDP): citizen message text may carry
                    Aadhaar/PAN/account/phone/email. Redact identity numbers at
                    render so they are not shown in the clear to every permitted
                    operator. Advisory best-effort pass (see lib/pii); the
                    service-side guardrail remains the authoritative control. */}
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{maskIdentifiers(entry.content)}</p>
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
