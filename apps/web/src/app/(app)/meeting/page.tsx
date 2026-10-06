import Link from "next/link";
import { PageHeader, StatCard, StatGrid, Card, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole, MEETING_CONFIG_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { getMeetings } from "./_data/loaders";

export const dynamic = "force-dynamic";

interface ConsoleTile {
  href: string;
  title: string;
  desc: string;
  /** When set, the tile is only rendered for a session holding one of these roles. */
  requiredRoles?: string[];
}

const CONSOLES: ConsoleTile[] = [
  {
    href: "/meeting/meetings",
    title: "Meetings & Console",
    desc: "Browse meetings, open the live console to run the agenda, track attendance and quorum, and drive the voting panel for the active motion.",
  },
  {
    href: "/meeting/admin",
    title: "Admin Configuration",
    desc: "Tune meeting policy — agenda deadlines, minutes workflow, escalation and permitted committee types — or apply a governance preset.",
    requiredRoles: MEETING_CONFIG_ADMIN_ROLES,
  },
];

export default async function MeetingHomePage() {
  const [all, inProgress] = await Promise.all([
    getMeetings(),
    getMeetings("in_progress"),
  ]);

  // GAP-MEETING-HOME-04: hide the Admin Configuration tile for non-admins (the
  // /meeting/admin page itself also enforces the role — hiding alone is not the
  // security boundary).
  const roles = getSessionRoles();
  const tiles = CONSOLES.filter((c) => !c.requiredRoles || hasAnyRole(roles, c.requiredRoles));

  // GAP-MEETING-HOME-03: adjourned (minutes not started) and minutes_pending
  // are distinct chase-states — keep them apart so the number is actionable.
  const scheduled = all.data.filter(
    (m) => m.status === "scheduled" || m.status === "agenda_locked",
  ).length;
  const adjourned = all.data.filter((m) => m.status === "adjourned").length;
  const minutesPending = all.data.filter((m) => m.status === "minutes_pending").length;

  // Both queries must succeed for the stats to be trustworthy — if either
  // fails we must not render a fabricated "0" (GAP-MEETING-HOME-01).
  const source = all.source === "error" || inProgress.source === "error" ? "error" : "api";
  const errored = source === "error";
  // When errored, show "—" (unknown via StatCard's null handling), never a fabricated zero.
  const stat = (n: number): string | null => (errored ? null : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title="Meeting Management"
        subtitle="Convene, conduct and record committee and board meetings — agenda to minutes, one place."
        actions={
          <Link className="btn primary" href="/meeting/meetings/new">
            + New meeting
          </Link>
        }
      />

      {errored ? (
        <RefreshErrorState
          error={{
            what: "We couldn't load meeting totals.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
        />
      ) : (
        <StatGrid>
          <StatCard
            icon="📋"
            tone="info"
            label="Total Meetings"
            value={stat(all.data.length)}
            href="/meeting/meetings"
          />
          <StatCard
            icon="🟢"
            tone="good"
            label="In Progress"
            value={stat(inProgress.data.length)}
            href="/meeting/meetings?status=in_progress"
          />
          <StatCard
            icon="📅"
            tone="info"
            label="Scheduled"
            value={stat(scheduled)}
            href="/meeting/meetings?status=scheduled"
          />
          <StatCard
            icon="📝"
            tone="warn"
            label="Minutes pending"
            value={stat(minutesPending)}
            hint="Meetings whose minutes draft is awaiting submission or approval."
            href="/meeting/meetings?status=minutes_pending"
          />
          <StatCard
            icon="⏳"
            tone="warn"
            label="Adjourned"
            value={stat(adjourned)}
            hint="Adjourned meetings whose minutes have not been started yet."
            href="/meeting/meetings?status=adjourned"
          />
        </StatGrid>
      )}

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          marginTop: 18,
        }}
      >
        {tiles.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card padding>
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
