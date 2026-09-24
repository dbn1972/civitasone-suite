import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type FeedItem = {
  type: string;
  id: string;
  createdAt: string;
  giver_name?: string;
  receiver_name?: string;
  badge?: string;
  message?: string;
  name?: string;
  department?: string;
  designation?: string;
  title?: string;
  body?: string;
  category?: string;
  pinned?: boolean;
  author?: string;
  joiningDate?: string;
} & Record<string, unknown>;

const BADGE_EMOJI: Record<string, string> = {
  star: "⭐", rocket: "🚀", heart: "❤️", trophy: "🏆", fire: "🔥", lightning: "⚡", thumbsup: "👍",
};

async function getData(): Promise<LoaderResult<FeedItem[]>> {
  const r = await fetchJson<unknown, FeedItem[]>("/api/v1/hrms/social/feed", [], {
    telemetryKey: "hr.social-feed",
    mapResponse: (p) => {
      const arr = (p as { data?: FeedItem[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function SocialFeedPage() {
  const t = await getTranslations("socialFeed");
  const { data: feed, source } = await getData();

  const errored = source === "error";
  const kudosCount        = feed.filter((f) => f.type === "kudos").length;
  const birthdayCount     = feed.filter((f) => f.type === "birthday").length;
  const newJoineeCount    = feed.filter((f) => f.type === "new_joinee").length;
  const announcementCount = feed.filter((f) => f.type === "announcement").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🌟" iconBg="var(--warnbg, #fffbe6)" label={t("statKudosLabel")}         value={errored ? "—" : kudosCount} />
        <StatCard icon="🎂" iconBg="var(--badbg, #fff0f6)" label={t("statBirthdaysLabel")}    value={errored ? "—" : birthdayCount} />
        <StatCard icon="👋" iconBg="var(--goodbg, #e6f7f0)" label={t("statNewJoineesLabel")}   value={errored ? "—" : newJoineeCount} />
        <StatCard icon="📢" iconBg="var(--infobg, #e6f0ff)" label={t("statAnnouncementsLabel")} value={errored ? "—" : announcementCount} />
      </StatGrid>

      {source === "error" ? (
        <Card title={t("cardTitleEmpty")}>
          <RefreshErrorState error={toHumanError("load", { area: "social feed" })} backHref="/hr" />
        </Card>
      ) : feed.length === 0 ? (
        <Card title={t("cardTitleEmpty")}>
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--mut)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{t("emptyTitle")}</p>
            <p style={{ fontSize: 14 }}>{t("emptyMessage")}</p>
          </div>
        </Card>
      ) : (
        <Card title={t("cardTitleLatest")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
            {feed.map((item) => {
              if (item.type === "kudos") {
                return (
                  <div key={item.id} style={{ display: "flex", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 28, flexShrink: 0 }}>{BADGE_EMOJI[item.badge ?? "star"]}</span>
                    <div>
                      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                        {t.rich("kudosLine", {
                          giver: item.giver_name ?? "",
                          receiver: item.receiver_name ?? "",
                          strongGiver: (chunks) => <strong>{chunks}</strong>,
                          strongReceiver: (chunks) => <strong>{chunks}</strong>,
                        })}
                      </p>
                      {item.message && (
                        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink2)", background: "var(--bg2)", borderRadius: 8, padding: "8px 12px", fontStyle: "italic" }}>
                          {item.message}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
              if (item.type === "birthday") {
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", background: "var(--warnbg, #fff9f0)", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 32 }}>🎂</span>
                    <div>
                      <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("birthdayGreeting", { name: item.name ?? "" })}</p>
                      <p style={{ fontSize: 12, color: "var(--mut)" }}>{item.designation} · {item.department}</p>
                    </div>
                  </div>
                );
              }
              if (item.type === "new_joinee") {
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", background: "var(--goodbg, #f0fff8)", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 32 }}>👋</span>
                    <div>
                      <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("newJoineeGreeting", { name: item.name ?? "" })}</p>
                      <p style={{ fontSize: 12, color: "var(--mut)" }}>{t("joinedAsLine", { designation: item.designation ?? "", department: item.department ?? "" })}</p>
                    </div>
                  </div>
                );
              }
              if (item.type === "announcement") {
                return (
                  <div key={item.id} style={{ display: "flex", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--line)", background: item.pinned ? "var(--infobg, #f5f8ff)" : "transparent" }}>
                    <span style={{ fontSize: 24 }}>{item.pinned ? "📌" : "📢"}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</p>
                      <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>{item.body}</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        {item.category && (
                          <span style={{ fontSize: 11, background: "var(--primary-l)", color: "var(--primary-d)", padding: "2px 8px", borderRadius: 20 }}>
                            {item.category}
                          </span>
                        )}
                        {item.author && (
                          <span style={{ fontSize: 11, color: "var(--mut)" }}>{t("byAuthorLine", { author: item.author })}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
