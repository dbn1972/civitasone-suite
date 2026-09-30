import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { GiveKudosButton } from "./GiveKudosButton";

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

type FeedCounts = { kudos7d: number; birthdaysToday: number; joinees30d: number; announcementsActive: number };
type FeedData = { items: FeedItem[]; counts: FeedCounts };

// GAP-HR-SOCIAL-FEED-04: this used to be indexed with `item.badge ?? "star"`
// directly, so any badge value outside these 7 keys (a legacy/stored value,
// or the map going stale relative to the API's own enum) rendered an empty
// 28px slot instead of falling back visibly. `badgeEmoji()` below always
// returns a real emoji.
const BADGE_EMOJI: Record<string, string> = {
  star: "⭐", rocket: "🚀", heart: "❤️", trophy: "🏆", fire: "🔥", lightning: "⚡", thumbsup: "👍",
};
function badgeEmoji(badge: string | undefined): string {
  return (badge && BADGE_EMOJI[badge]) || BADGE_EMOJI.star;
}

async function getData(): Promise<LoaderResult<FeedData>> {
  return fetchJson<unknown, FeedData>(
    "/api/v1/hrms/social/feed",
    { items: [], counts: { kudos7d: 0, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 } },
    {
      telemetryKey: "hr.social-feed",
      mapResponse: (p) => {
        const body = p as { data?: FeedItem[]; counts?: Partial<FeedCounts> };
        if (!Array.isArray(body?.data)) return null;
        const c = body.counts ?? {};
        return {
          items: body.data,
          // GAP-HR-SOCIAL-FEED-02: these used to be computed client-side by
          // filtering the already-truncated feed array (capped at 10/5/10/30
          // server-side), so e.g. "New Joinees" could never read above 5.
          // Now real COUNT(*) totals from the backend, independent of the
          // feed's own display caps.
          counts: {
            kudos7d: Number(c.kudos7d ?? 0),
            birthdaysToday: Number(c.birthdaysToday ?? 0),
            joinees30d: Number(c.joinees30d ?? 0),
            announcementsActive: Number(c.announcementsActive ?? 0),
          },
        };
      },
    },
  );
}

export default async function SocialFeedPage() {
  const t = await getTranslations("socialFeed");
  const { data: page, source, status, errorMessage } = await getData();
  const feed = page.items;
  const counts = page.counts;

  const errored = source === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel={t("backToHr")}
        actions={<GiveKudosButton label={t("giveKudosBtn")} />}
      />
      {!errored ? <DataSourceBadge source={source} /> : null}
      <StatGrid>
        <StatCard icon="🌟" iconBg="var(--warnbg, #fffbe6)" label={t("statKudosLabel")}         value={errored ? "—" : counts.kudos7d} />
        <StatCard icon="🎂" iconBg="var(--badbg, #fff0f6)" label={t("statBirthdaysLabel")}    value={errored ? "—" : counts.birthdaysToday} />
        <StatCard icon="👋" iconBg="var(--goodbg, #e6f7f0)" label={t("statNewJoineesLabel")}   value={errored ? "—" : counts.joinees30d} />
        <StatCard icon="📢" iconBg="var(--infobg, #e6f0ff)" label={t("statAnnouncementsLabel")} value={errored ? "—" : counts.announcementsActive} />
      </StatGrid>

      {/* GAP-HR-SOCIAL-FEED-06: card title used to switch between
          "Feed" (error AND empty) and "Latest Updates" (filled) -- now one
          constant title in all three states. */}
      {errored ? (
        <Card title={t("cardTitle")}>
          <LoadErrorState result={{ status, errorMessage }} area="social feed" backHref="/hr" />
        </Card>
      ) : feed.length === 0 ? (
        <Card title={t("cardTitle")}>
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--mut)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{t("emptyTitle")}</p>
            {/* GAP-HR-SOCIAL-FEED-03: this used to promise a "Give kudos"
                action that didn't exist anywhere on the page. Now that the
                header's Give Kudos button (EntityPicker-backed, see
                GiveKudosButton.tsx) actually exists, this copy is honest
                again. */}
            <p style={{ fontSize: 14 }}>{t("emptyMessage")}</p>
          </div>
        </Card>
      ) : (
        <Card title={t("cardTitle")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
            {feed.map((item) => {
              if (item.type === "kudos") {
                return (
                  <div key={item.id} style={{ display: "flex", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 28, flexShrink: 0 }} aria-hidden="true">{badgeEmoji(item.badge)}</span>
                    <span className="sr-only">{t("kudosTypeLabel")}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                          {t.rich("kudosLine", {
                            giver: item.giver_name ?? "",
                            receiver: item.receiver_name ?? "",
                            strongGiver: (chunks) => <strong>{chunks}</strong>,
                            strongReceiver: (chunks) => <strong>{chunks}</strong>,
                          })}
                        </p>
                        {/* GAP-HR-SOCIAL-FEED-03: every feed item already
                            carries createdAt; it was never rendered anywhere,
                            so a 7-day-old kudos and a today one looked the
                            same. Rendered for all 4 item types below, not
                            just this one. */}
                        <span style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap" }}>{formatIndianDate(item.createdAt)}</span>
                      </div>
                      {item.message && (
                        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink2)", background: "var(--bg2, #f5f5f5)", borderRadius: 8, padding: "8px 12px", fontStyle: "italic" }}>
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
                    <span style={{ fontSize: 32 }} aria-hidden="true">🎂</span>
                    <span className="sr-only">{t("birthdayTypeLabel")}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("birthdayGreeting", { name: item.name ?? "" })}</p>
                        <span style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap" }}>{formatIndianDate(item.createdAt)}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--mut)" }}>{item.designation} · {item.department}</p>
                    </div>
                  </div>
                );
              }
              if (item.type === "new_joinee") {
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", background: "var(--goodbg, #f0fff8)", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 32 }} aria-hidden="true">👋</span>
                    <span className="sr-only">{t("newJoineeTypeLabel")}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("newJoineeGreeting", { name: item.name ?? "" })}</p>
                        <span style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap" }}>{formatIndianDate(item.createdAt)}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--mut)" }}>{t("joinedAsLine", { designation: item.designation ?? "", department: item.department ?? "" })}</p>
                    </div>
                  </div>
                );
              }
              if (item.type === "announcement") {
                return (
                  <div key={item.id} style={{ display: "flex", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--line)", background: item.pinned ? "var(--infobg, #f5f8ff)" : "transparent" }}>
                    <span style={{ fontSize: 24 }} aria-hidden="true">{item.pinned ? "📌" : "📢"}</span>
                    <span className="sr-only">{t("announcementTypeLabel")}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <p style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</p>
                        <span style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap" }}>{formatIndianDate(item.createdAt)}</span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>{item.body}</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        {item.category && (
                          <span style={{ fontSize: 11, background: "var(--primary-l, #dbeafe)", color: "var(--primary-d, #1e40af)", padding: "2px 8px", borderRadius: 20 }}>
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
