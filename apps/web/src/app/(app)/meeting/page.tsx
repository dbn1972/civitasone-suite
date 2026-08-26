import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { getMeetings } from "./_data/loaders";

export const dynamic = "force-dynamic";

const CONSOLES = [
  {
    href: "/meeting/meetings",
    icon: "🗂️",
    title: "Meetings & Console",
    desc: "Browse meetings, open the live console to run the agenda, track attendance and quorum, and drive the voting panel for the active motion.",
  },
  {
    href: "/meeting/admin",
    icon: "⚙️",
    title: "Admin Configuration",
    desc: "Tune meeting policy — agenda deadlines, minutes workflow, escalation and permitted committee types — or apply a governance preset.",
  },
];

export default async function MeetingHomePage() {
  const [all, inProgress] = await Promise.all([
    getMeetings(),
    getMeetings("in_progress"),
  ]);

  const scheduled = all.data.filter(
    (m) => m.status === "scheduled" || m.status === "agenda_locked",
  ).length;
  const minutesPending = all.data.filter(
    (m) => m.status === "minutes_pending" || m.status === "adjourned",
  ).length;
  // Both queries must succeed for the stats above to be trustworthy — if only
  // "in progress" fails, the count silently shows 0 with no error indication
  // unless we check its source too (fixes silent-zero bug).
  const source = all.source === "error" || inProgress.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Meeting Management"
        subtitle="Convene, conduct and record committee and board meetings — agenda to minutes, one place."
      />
      {source === "error" && (
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      )}
      <StatGrid>
        <StatCard
          icon="📋"
          iconBg="#eef2ff"
          label="Total Meetings"
          value={all.data.length.toLocaleString("en-IN")}
        />
        <StatCard
          icon="🟢"
          iconBg="#ecfdf5"
          label="In Progress"
          value={inProgress.data.length.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📅"
          iconBg="#ecfeff"
          label="Scheduled"
          value={scheduled.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📝"
          iconBg="#fff7ed"
          label="Awaiting Minutes"
          value={minutesPending.toLocaleString("en-IN")}
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
