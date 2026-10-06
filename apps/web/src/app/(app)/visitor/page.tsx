import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid, Card, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole, VISITOR_ADMIN_ROLES, VISITOR_GUARD_ROLES } from "@/lib/auth/roleGuard";
import { getVisitRequests } from "./_data/loaders";
import { isToday, isTodayOrLater } from "./_data/format";

export const dynamic = "force-dynamic";

const CONSOLES = [
  {
    href: "/visitor/guard",
    icon: "🛂",
    titleKey: "guardTitle",
    descKey: "guardDesc",
    roles: VISITOR_GUARD_ROLES,
  },
  {
    href: "/visitor/host",
    icon: "✅",
    titleKey: "hostTitle",
    descKey: "hostDesc",
    roles: null, // every authenticated user is some request's potential host
  },
  {
    href: "/visitor/admin",
    icon: "⚙️",
    titleKey: "adminTitle",
    descKey: "adminDesc",
    roles: VISITOR_ADMIN_ROLES,
  },
] as const;

export default async function VisitorHomePage() {
  const t = await getTranslations("visitor.home");
  const [pending, approved] = await Promise.all([
    getVisitRequests("pending_approval"),
    getVisitRequests("approved"),
  ]);

  // GAP-VISITOR-HOME-01 (FAILMASK): a failed fetch must read as "we don't
  // know" ("—"), never a fabricated zero that a supervisor could misread as
  // "no visitors" during an outage. Track each count's own source so one
  // failed status does not mask (or get masked by) the other.
  const pendingValue = pending.source === "error" ? undefined : pending.data.length.toLocaleString("en-IN");
  // GAP-VISITOR-HOME-04 (LABEL): "Approved — upcoming" counts only approved
  // visits scheduled today or later (IST), not every approved request ever,
  // so the metric matches its label and does not accrue stale past visits.
  const expectedToday = approved.source === "error"
    ? undefined
    : approved.data.filter((r) => isToday(r.scheduledAt)).length.toLocaleString("en-IN");
  const upcoming = approved.source === "error"
    ? undefined
    : approved.data.filter((r) => isTodayOrLater(r.scheduledAt)).length.toLocaleString("en-IN");

  const anyError = pending.source === "error" || approved.source === "error";

  // GAP-VISITOR-HOME-02: only show tiles the user's role can actually open, so
  // the hub matches the role-gated layouts (and the server's own enforcement).
  const roles = getSessionRoles();
  const consoles = CONSOLES.filter((c) => c.roles === null || hasAnyRole(roles, c.roles));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      {anyError && (
        <RefreshErrorState
          error={{
            what: t("countsError"),
            next: t("countsErrorNext"),
            actions: ["retry"],
          }}
        />
      )}
      <StatGrid>
        <StatCard icon="🕓" iconBg="#fff7ed" label={t("statAwaiting")} value={pendingValue} />
        <StatCard icon="📅" iconBg="#ecfeff" label={t("statExpectedToday")} value={expectedToday} />
        <StatCard icon="✅" iconBg="#ecfdf5" label={t("statUpcoming")} value={upcoming} />
      </StatGrid>

      <div className="grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", marginTop: 18 }}>
        {consoles.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card padding>
              <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>{c.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t(c.titleKey)}</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{t(c.descKey)}</p>
              <div className="lnk" style={{ marginTop: 12, color: "var(--primary-d)", fontWeight: 650, fontSize: 13 }}>
                {t("open")} →
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
