import Link from "next/link";
import { useDays, useMonthEnds } from "./useDays";

interface Props {
  userName: string;
  // GAP-HR-DASHBOARD-08: computed server-side in page.tsx from the real
  // current hour in Asia/Kolkata (see greetingForHour/currentIstHour there)
  // -- replaces the previous `dayName.startsWith("S") ? "Good day" : "Good
  // morning"` weekday hack, which never reflected the actual time of day.
  greeting: string;
  // Sourced from the HR dashboard loader (page.tsx's data.pendingLeaves) --
  // null/undefined means the load genuinely failed, not "zero pending
  // actions". Same underlying field as HRKPIStrip's pendingLeaves prop; see
  // that component's hasValue() guard for the same fix on the same bug class.
  pendingCount: number | null | undefined;
  // Always locally derived from the calendar (see page.tsx's
  // payrollDaysLeft()), never sourced from a loader -- so unlike
  // pendingCount it can't come back "absent" and doesn't need a
  // null/undefined case. Same reasoning as HRKPIStrip.tsx's own
  // payrollDaysLeft prop (also left as plain number there).
  payrollDaysLeft: number;
  today: string;   // pre-formatted server-side to avoid hydration mismatch
  dayName: string;
  // Optional so every existing caller/test (which all render the HR-admin
  // dashboard) keeps getting the original two admin-shaped links with no
  // changes required. hr/dashboard/page.tsx's employee-role branch passes a
  // different, self-service-shaped pair instead -- "Export Report" and
  // "+ Add Employee" are HR-admin actions a plain employee can't use (the
  // backend 403s the add-employee POST for that role), so showing them
  // there would just be this same class of bug in miniature.
  actions?: { label: string; href: string; primary?: boolean }[];
}

const DEFAULT_ACTIONS: NonNullable<Props["actions"]> = [
  // GAP-HR-DASHBOARD-06: was "/hr/payroll" -- not a report, a dead-end link.
  // /reports/list/new?reportType=hr is a real, working report-generation
  // flow (the generic reports pipeline's own form offers "hr" as its
  // example report-type value).
  { label: "Export Report", href: "/reports/list/new?reportType=hr" },
  { label: "+ Add Employee", href: "/hr/employees/new", primary: true },
];

// A failed dashboard load must read as "we don't know", not as a fabricated
// zero -- a hard `0` here falls through to "No urgent actions today", which
// is indistinguishable on screen from a genuine all-clear. Same guard as
// StatCard.tsx's displayValue() / HRKPIStrip.tsx's hasValue() for the same
// bug class.
function hasValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function GreetingHeader({ userName, greeting, pendingCount, payrollDaysLeft, today, dayName, actions = DEFAULT_ACTIONS }: Props) {
  const formatDays = useDays();
  const monthEnds = useMonthEnds();
  // hasValue(pendingCount) is checked first and short-circuits the rest of
  // the chain on purpose: if we don't know the real pending count, we can't
  // conclude "nothing urgent", and silently falling back to the payroll
  // clause (or further, to "No urgent actions today") would still read as a
  // disguised all-clear.
  const briefing = !hasValue(pendingCount)
    ? "We couldn't load your pending actions"
    : pendingCount > 0
    ? `${pendingCount} item${pendingCount > 1 ? "s" : ""} need${pendingCount === 1 ? "s" : ""} your attention`
    : payrollDaysLeft <= 7
    // GAP-HR-DASHBOARD-05: this used to read "Payroll closes in N days", but
    // payrollDaysLeft is calendar days to month-end, not a payroll cutoff --
    // the app has no payroll calendar to source one from (an open product
    // decision). Same honest relabel HRKPIStrip's card already got.
    ? monthEnds(formatDays(payrollDaysLeft))
    : "No urgent actions today";

  return (
    <div className="greeting-header">
      <div className="greeting-inner">
        <div className="greeting-text" data-testid="dashboard-greeting">
          <p className="greeting-eyebrow">HR & Payroll · People Operations</p>
          {/* h2, not h1: the page's real (sr-only) h1 is
              #hr-dash-heading in page.tsx -- this personalized greeting is a
              banner within the page, not the page's title, and having both
              be <h1> gave the page two competing top-level headings.
              className drives all visual styling, so demoting the tag is a
              no-op for layout/appearance. */}
          <h2 className="greeting-title">
            {greeting}, {userName}
          </h2>
          <p className="greeting-sub">
            {dayName}, {today} · {briefing}
          </p>
        </div>
        <div className="greeting-actions">
          <Link
            href="/help/hr"
            className="btn-ghost-nav"
            aria-label="How this works — plain-language help"
            title="How this works"
          >
            ❓ How this works
          </Link>
          {actions.map((a) => (
            <Link key={a.href + a.label} href={a.href} className={a.primary ? "btn-primary-nav" : "btn-ghost-nav"}>{a.label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
