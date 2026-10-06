import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { StatIcon } from "@/app/_components/ds/StatIcon";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { WORKS_ADMIN_ROLES, WORKS_READ_ROLES, worksRolesAllow } from "@/lib/auth/workRoles";
import { draftProposals, sumPendingProposals } from "./_data/status";

type DashboardData = {
  totalWorks: number;
  activeWorks: number;
  closedWorks: number;
  byStatus: Record<string, number>;
};

function isDashboard(v: unknown): v is { data: DashboardData } {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as { data?: unknown }).data;
  return typeof d === "object" && d !== null && typeof (d as DashboardData).totalWorks === "number";
}

async function getWorksDashboard(): Promise<LoaderResult<DashboardData>> {
  return fetchJson<unknown, DashboardData>(
    "/api/v1/works/dashboard",
    { totalWorks: 0, activeWorks: 0, closedWorks: 0, byStatus: {} },
    {
      telemetryKey: "works.dashboard",
      mapResponse: (payload) => (isDashboard(payload) ? payload.data : null),
    },
  );
}

/**
 * Hub tiles. `icon` is an emoji glyph resolved to a lucide vector by StatIcon
 * (headless-safe — see StatIcon.tsx); `labelKey`/`descKey` resolve under
 * works.hub.tiles.*. `roles`, when set, gates the tile to a session role set
 * (GAP-WORKS-HOME-05) — the server still enforces access, this only avoids
 * offering a tile the destination page/API would reject.
 */
const MODULES: Array<{
  href: string;
  key: string;
  icon: string;
  roles?: readonly string[];
}> = [
  { href: "/works/proposals", key: "proposals", icon: "📋" },
  { href: "/works/tenders", key: "tenders", icon: "📢" },
  { href: "/works/contractors", key: "contractors", icon: "🏢" },
  { href: "/works/execution", key: "execution", icon: "🏗" },
  { href: "/works/billing", key: "billing", icon: "💰" },
  { href: "/procurement", key: "procurement", icon: "📦" },
  { href: "/works/masters", key: "masters", icon: "📚", roles: WORKS_READ_ROLES },
  { href: "/works/reports", key: "reports", icon: "📊", roles: WORKS_READ_ROLES },
];

export default async function WorksHub() {
  const t = await getTranslations("works.hub");
  const { data: dash, source } = await getWorksDashboard();
  const roles = getSessionRoles();
  const canAdmin = worksRolesAllow(roles, WORKS_ADMIN_ROLES);

  // GAP-WORKS-HOME-01 (FAILMASK): on a failed fetch, show "—" (StatCard renders
  // null as an em dash) instead of a fabricated 0 that is indistinguishable
  // from a genuine empty dashboard.
  const failed = source === "error";
  const draftCount = failed ? null : draftProposals(dash.byStatus);
  // GAP-WORKS-HOME-02: pending = past-draft, derived from the real status
  // vocabulary (dao_finalized + ts_eligible), not the never-present
  // "submitted"/"pending" keys the hub used to read.
  const pendingCount = failed ? null : sumPendingProposals(dash.byStatus);

  // GAP-WORKS-HOME-05: tiles with a `roles` gate are shown only to those roles.
  const visibleModules = MODULES.filter((m) => !m.roles || worksRolesAllow(roles, m.roles));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={failed ? <DataSourceBadge source="error" message={t("loadError")} /> : null}
      />

      <StatGrid>
        <StatCard icon="🏗" tone="info" label={t("stats.total")} value={failed ? null : dash.totalWorks} />
        <StatCard icon="▶️" tone="good" label={t("stats.active")} value={failed ? null : dash.activeWorks} />
        <StatCard icon="✅" tone="neutral" label={t("stats.completed")} value={failed ? null : dash.closedWorks} />
        <StatCard icon="📝" tone="warn" label={t("stats.draft")} value={draftCount} />
        <StatCard icon="⏳" tone="bad" label={t("stats.pending")} value={pendingCount} />
      </StatGrid>

      {canAdmin && (
        <Card title={t("quickActions.title")} padding>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href="/works/proposals/new" className="btn ghost" style={{ fontSize: 13 }}>{t("quickActions.newProposal")}</Link>
            <Link href="/works/tenders/new" className="btn ghost" style={{ fontSize: 13 }}>{t("quickActions.createTender")}</Link>
            <Link href="/works/contractors/new" className="btn ghost" style={{ fontSize: 13 }}>{t("quickActions.registerContractor")}</Link>
            <Link href="/works/billing/account-compile" className="btn ghost" style={{ fontSize: 13 }}>{t("quickActions.accountCompile")}</Link>
          </div>
        </Card>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 8,
        }}
      >
        {visibleModules.map(({ href, icon, key }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 20,
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--surface, #fff)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>
              <StatIcon icon={icon} size={28} />
            </span>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{t(`tiles.${key}.label`)}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{t(`tiles.${key}.desc`)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
