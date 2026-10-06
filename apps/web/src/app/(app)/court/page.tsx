import Link from "next/link";
import { CalendarDays, FolderOpen, Gavel, ScrollText, Settings } from "lucide-react";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { humanize } from "./_data/format";
import { getAnalytics, getCases, getPendency } from "./_data/loaders";

export const dynamic = "force-dynamic";

const CONSOLES = [
  {
    href: "/court/cases",
    Icon: FolderOpen,
    title: "Cases & Registry",
    desc: "Browse the case registry, open a case to see parties, drive the lifecycle, schedule hearings, and draft & issue orders.",
  },
  {
    href: "/court/cause-list",
    Icon: CalendarDays,
    title: "Daily Cause List",
    desc: "Generate the day's cause list for a court, then list cases onto numbered slots and courtrooms for the bench.",
  },
  {
    href: "/court/admin",
    Icon: Settings,
    title: "Admin Configuration",
    desc: "Manage the §47 config engine — case, court and order types, hearing purposes, party roles and the disposal SLA — or apply a vertical preset.",
  },
  {
    href: "/court/hearings",
    Icon: Gavel,
    title: "Hearings",
    desc: "Pick a case to schedule hearings, record outcomes and adjournments across its lifecycle.",
  },
  {
    href: "/court/orders",
    Icon: ScrollText,
    title: "Orders",
    desc: "Pick a case to draft orders and drive the approval & issuance (DSC, maker-checker) workflow.",
  },
];

export default async function CourtHomePage() {
  const [all, pendency, analytics] = await Promise.all([
    getCases(),
    getPendency(),
    getAnalytics(),
  ]);

  // GAP-COURT-HOME-01/02: each KPI reflects ITS OWN loader's health. A failed
  // getAnalytics() must not render "0" disposed as a fact; it renders "—".
  // GAP-COURT-HOME-02: Disposed comes from analytics.disposed (the same figure
  // that drives the Clearance Rate), never a client-side filter over a capped
  // (limit=100) case list which can disagree with and undercount it.
  const anyError =
    all.source === "error" || pendency.source === "error" || analytics.source === "error";

  // "Total Cases" is sourced from analytics.instituted (not the capped list
  // length, which was at most 100 and shown as if it were the true total).
  const totalCases =
    analytics.source === "error" ? "—" : analytics.data.instituted.toLocaleString("en-IN");
  const pending =
    pendency.source === "error" ? "—" : pendency.data.total.toLocaleString("en-IN");
  const disposed =
    analytics.source === "error" ? "—" : analytics.data.disposed.toLocaleString("en-IN");
  const clearance =
    analytics.source === "error"
      ? "—"
      : analytics.data.clearanceRatePct != null
        ? `${analytics.data.clearanceRatePct}%`
        : "—";

  // GAP-COURT-HOME-03: show the pendency breakdown by status, not only .total.
  const pendencyRows =
    pendency.source === "error" ? [] : pendency.data.summary.filter((r) => r.count > 0);

  return (
    <>
      <PageHeader
        title="Court Management"
        subtitle="Register, hear and dispose matters — from filing and cause list to hearings, orders and issuance, one place."
      />
      {anyError && (
        <DataSourceBadge source="error" message="Some figures couldn't be loaded — those show “—”." />
      )}
      <StatGrid>
        <StatCard icon="📚" iconBg="#eef2ff" label="Total Cases" value={totalCases} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Disposed" value={disposed} />
        <StatCard icon="📈" iconBg="#ecfeff" label="Clearance Rate" value={clearance} />
      </StatGrid>

      {pendency.source !== "error" && pendencyRows.length > 0 && (
        <Card title="Pendency by status" padding style={{ marginTop: 18 }}>
          <ul style={{ display: "flex", flexWrap: "wrap", gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
            {pendencyRows.map((r) => (
              <li
                key={r.status}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "6px 12px",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>{humanize(r.status)}</span>
                <strong style={{ fontSize: 14 }}>{r.count.toLocaleString("en-IN")}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          marginTop: 18,
        }}
      >
        {CONSOLES.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card padding>
              <div style={{ marginBottom: 8, color: "var(--primary-d)" }} aria-hidden>
                <c.Icon size={28} strokeWidth={1.75} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{c.title}</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{c.desc}</p>
              <div
                className="lnk"
                style={{ marginTop: 12, color: "var(--primary-d)", fontWeight: 650, fontSize: 13 }}
              >
                Open →
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
