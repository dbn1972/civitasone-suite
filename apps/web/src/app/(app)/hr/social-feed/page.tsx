import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { GiveKudosButton } from "./GiveKudosButton";
import { FeedRow, type FeedItem } from "./FeedRow";
import { BirthdaySharingToggle } from "./BirthdaySharingToggle";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { HR_SELF_SERVICE_ROLES } from "@/lib/auth/workRoles";

type FeedCounts = { kudos7d: number; birthdaysToday: number; joinees30d: number; announcementsActive: number };
type FeedData = { items: FeedItem[]; counts: FeedCounts };

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

type BirthdaySharing = { linked: boolean; shareBirthday: boolean };

// GAP-HR-SOCIAL-FEED-01 (DPDP): the caller's own birthday-sharing consent. If
// this read fails the toggle is simply not offered (never guessed as "on").
async function getBirthdaySharing(): Promise<LoaderResult<BirthdaySharing>> {
  return fetchJson<unknown, BirthdaySharing>(
    "/api/v1/hrms/me/birthday-sharing",
    { linked: false, shareBirthday: false },
    {
      telemetryKey: "hr.social-feed.birthday-sharing",
      mapResponse: (p) => {
        const d = (p as { data?: Partial<BirthdaySharing> })?.data;
        if (!d || typeof d !== "object") return null;
        return { linked: d.linked === true, shareBirthday: d.shareBirthday === true };
      },
    },
  );
}

export default async function SocialFeedPage() {
  requireAnyRole(HR_SELF_SERVICE_ROLES);
  const t = await getTranslations("socialFeed");
  const [{ data: page, source, status, errorMessage }, sharingResult] = await Promise.all([getData(), getBirthdaySharing()]);
  const canSetBirthdaySharing = sharingResult.source !== "error" && sharingResult.data.linked;
  const feed = page.items;
  const counts = page.counts;

  const errored = source === "error";

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel={t("backToHr")}
        actions={<GiveKudosButton label={t("giveKudosBtn")} />}
      />
      {!errored ? <DataSourceBadge source={source} /> : null}
      <StatGrid>
        <StatCard icon="🌟" iconBg="var(--warnbg)" label={t("statKudosLabel")}         value={errored ? "—" : counts.kudos7d} />
        <StatCard icon="🎂" iconBg="var(--badbg)" label={t("statBirthdaysLabel")}    value={errored ? "—" : counts.birthdaysToday} />
        <StatCard icon="👋" iconBg="var(--goodbg)" label={t("statNewJoineesLabel")}   value={errored ? "—" : counts.joinees30d} />
        <StatCard icon="📢" iconBg="var(--infobg)" label={t("statAnnouncementsLabel")} value={errored ? "—" : counts.announcementsActive} />
      </StatGrid>

      {canSetBirthdaySharing ? (
        <Card title={t("birthdaySharingTitle")}>
          <div className="pad">
            <BirthdaySharingToggle initialShare={sharingResult.data.shareBirthday} />
          </div>
        </Card>
      ) : null}

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
            {feed.map((item) => <FeedRow key={item.id} item={item} />)}
          </div>
        </Card>
      )}
    </div>
  );
}
