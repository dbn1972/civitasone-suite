import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { getAnalytics, getCases, getPendency } from "./_data/loaders";

export const dynamic = "force-dynamic";

const CONSOLES = [
  {
    href: "/court/cases",
    icon: "🗂️",
    title: "Cases & Registry",
    desc: "Browse the case registry, open a case to see parties, drive the lifecycle, schedule hearings, and draft & issue orders.",
  },
  {
    href: "/court/cause-list",
    icon: "📅",
    title: "Daily Cause List",
    desc: "Generate the day's cause list for a court, then list cases onto numbered slots and courtrooms for the bench.",
  },
  {
    href: "/court/admin",
    icon: "⚙️",
    title: "Admin Configuration",
    desc: "Manage the §47 config engine — case, court and order types, hearing purposes, party roles and the disposal SLA — or apply a vertical preset.",
  },
];

export default async function CourtHomePage() {
  const [all, pendency, analytics] = await Promise.all([
    getCases(),
    getPendency(),
    getAnalytics(),
  ]);

  const disposed = all.data.filter((c) => c.status === "disposed").length;
  const source =
    all.source === "error" && pendency.source === "error" && analytics.source === "error"
      ? "error"
      : "api";
  const clearance =
    analytics.data.clearanceRatePct != null
      ? `${analytics.data.clearanceRatePct}%`
      : "—";

  return (
    <>
      <PageHeader
        title="Court Management"
        subtitle="Register, hear and dispose matters — from filing and cause list to hearings, orders and issuance, one place."
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard
          icon="📚"
          iconBg="#eef2ff"
          label="Total Cases"
          value={all.data.length.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⏳"
          iconBg="#fff7ed"
          label="Pending"
          value={pendency.data.total.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          iconBg="#ecfdf5"
          label="Disposed"
          value={disposed.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📈"
          iconBg="#ecfeff"
          label="Clearance Rate"
          value={clearance}
        />
      </StatGrid>

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
              <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>
                {c.icon}
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
