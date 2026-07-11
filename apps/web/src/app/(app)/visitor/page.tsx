import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { getVisitRequests } from "./_data/loaders";
import { isToday } from "./_data/format";

export const dynamic = "force-dynamic";

const CONSOLES = [
  {
    href: "/visitor/guard",
    icon: "🛂",
    title: "Guard Console",
    desc: "Verify passes at the gate, see who is expected today, and manage the live inside-now roster with overstay flags.",
  },
  {
    href: "/visitor/host",
    icon: "✅",
    title: "Host Portal",
    desc: "Approve or reject visit requests raised for you, and review your expected visitors for the day.",
  },
  {
    href: "/visitor/admin",
    icon: "⚙️",
    title: "Admin Configuration",
    desc: "Tune visitor policy — retention, approvals, overstay and pass rules — or apply a vertical preset.",
  },
];

export default async function VisitorHomePage() {
  const [pending, approved] = await Promise.all([
    getVisitRequests("pending_approval"),
    getVisitRequests("approved"),
  ]);

  const expectedToday = approved.data.filter((r) => isToday(r.scheduledAt)).length;
  const source = pending.source === "error" || approved.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Visitor Management"
        subtitle="Gate operations, host approvals and premises policy — one place."
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🕓" iconBg="#fff7ed" label="Awaiting Approval" value={pending.data.length.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#ecfeff" label="Expected Today" value={expectedToday.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Approved (all)" value={approved.data.length.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", marginTop: 18 }}>
        {CONSOLES.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card padding>
              <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>{c.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{c.title}</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{c.desc}</p>
              <div className="lnk" style={{ marginTop: 12, color: "var(--primary-d)", fontWeight: 650, fontSize: 13 }}>
                Open →
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
