import Link from "next/link";

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
    ? `Payroll closes in ${payrollDaysLeft} day${payrollDaysLeft !== 1 ? "s" : ""}`
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
      <style>{`
        .greeting-header {
          /* GAP-HR-DASHBOARD-09: wrapped in var(--token, #same-fallback) --
             no --dash-greeting-* token is defined anywhere, so this renders
             identically to the previous bare-hex gradient. Page-local names
             (not a reuse of an existing design-system token) since this
             gradient's exact stops are bespoke to this one banner and its
             own hand-verified WCAG contrast math below, not shared elsewhere. */
          background: linear-gradient(108deg, var(--dash-greeting-grad-1, #0f2240) 0%, var(--dash-greeting-grad-2, #1a3a6b) 60%, var(--dash-greeting-grad-3, #2554a0) 100%);
          padding: 20px 28px 0;
          position: relative;
          overflow: hidden;
        }
        .greeting-header::after {
          content: '';
          display: block;
          height: 18px;
          background: var(--page-bg, #eef2f7);
          clip-path: ellipse(54% 100% at 50% 100%);
          margin: 0 -28px;
        }
        .greeting-inner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding-bottom: 14px;
          flex-wrap: wrap;
        }
        .greeting-text {
          /* Fill the row instead of shrink-wrapping to the greeting text.
             Content-driven width would otherwise make this box's own size
             (not just its text) depend on the greeting's length, e.g.
             "Good morning" (weekday) vs "Good day" (weekend) render at
             different widths -- shifting this element's bounding box day
             to day even though its content is masked in visual-regression
             screenshots (see visual-regression.spec.ts). flex-basis 0 with
             flex-grow keeps the box's width pinned to the layout instead. */
          flex: 1 1 0;
          min-width: 0;
        }
        .greeting-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .12em;
          text-transform: uppercase;
          /* UX-005 tranche 10: #6ea3f5 measured 2.88:1 against the lightest
             gradient stop (#2554a0) -- axe reports this "incomplete"
             (bgGradient, undecidable) rather than a violation, but the
             worst-case background is computable directly from the gradient's
             own stops, and it fails. #bfdbfe clears 4.5:1 at that same
             worst-case stop (5.18:1), so it holds across the whole gradient. */
          color: var(--dash-greeting-eyebrow, #bfdbfe);
          margin: 0 0 4px;
        }
        .greeting-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--dash-greeting-title, #f0f6ff);
          letter-spacing: -.02em;
          margin: 0 0 3px;
        }
        .greeting-sub {
          font-size: 12px;
          /* UX-005 tranche 10: #7ea8d8 measured 2.97:1 at the gradient's
             lightest stop -- same bgGradient/incomplete case as
             .greeting-eyebrow above. #dbeafe clears 4.5:1 there (6.03:1). */
          color: var(--dash-greeting-sub, #dbeafe);
          margin: 0;
        }
        .greeting-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          padding-top: 4px;
          flex-shrink: 0;
        }
        .btn-ghost-nav {
          background: rgba(255,255,255,.12);
          /* UX-005 tranche 10: #c8daf5 over this translucent-white chip,
             composited on the gradient's lightest stop, measured 3.88:1
             (bgGradient/incomplete). #fff clears 4.5:1 there (5.50:1),
             matching .btn-primary-nav's own use of solid white text. */
          color: var(--dash-greeting-btn-fg, #ffffff);
          border: 1px solid rgba(255,255,255,.15);
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          text-decoration: none;
          white-space: nowrap;
        }
        .btn-primary-nav {
          /* This exact hex already matches the established --info token's
             own fallback value used fleet-wide (e.g. var(--info, #2563eb) in
             every dashboard SVG icon in this file family) -- reused directly
             rather than inventing a new page-local name for it. */
          background: var(--info, #2563eb);
          color: var(--dash-greeting-btn-fg, #fff);
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          padding: 7px 14px;
          text-decoration: none;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
