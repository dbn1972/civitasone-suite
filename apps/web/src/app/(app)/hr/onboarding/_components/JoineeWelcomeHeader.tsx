/**
 * JoineeWelcomeHeader — top-of-page welcome banner for a new joinee.
 * Shows name, start date, department, reporting manager, and office address
 * in standard Indian address format.
 */

interface JoineeWelcomeHeaderProps {
  name: string;
  startDate: string;          // ISO date string, e.g. "2026-09-01"
  department: string;
  reportingManager: string;
  officeLocation: string;     // Full Indian address, e.g. "Block A, Sector 12, Navi Mumbai, MH – 400 614"
  avatarInitials?: string;
  overallProgress: number;    // 0–100
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function progressColor(pct: number): string {
  if (pct >= 80) return "var(--green, #16a34a)";
  if (pct >= 40) return "var(--amber, #d97706)";
  return "var(--blue, #4f46e5)";
}

export function JoineeWelcomeHeader({
  name,
  startDate,
  department,
  reportingManager,
  officeLocation,
  avatarInitials,
  overallProgress,
}: JoineeWelcomeHeaderProps) {
  const initials = avatarInitials ?? name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const pct = Math.min(100, Math.max(0, overallProgress));
  const col = progressColor(pct);

  return (
    <div
      data-testid="joinee-welcome-header"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 20,
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 12,
        padding: "24px 28px",
        marginBottom: 20,
      }}
    >
      {/* Avatar circle */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: 1,
        }}
      >
        {initials}
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--heading, #1e293b)" }}>
            Welcome, {name}!
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 99,
              background: "#ede9fe",
              color: "#5b21b6",
              letterSpacing: "0.03em",
            }}
          >
            NEW JOINEE
          </span>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "8px 20px",
            margin: "12px 0 0",
            padding: 0,
          }}
        >
          {[
            { label: "Start Date", value: formatDate(startDate) },
            { label: "Department", value: department },
            { label: "Reporting Manager", value: reportingManager },
            { label: "Office Location", value: officeLocation },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt style={{ fontSize: 11, fontWeight: 600, color: "var(--muted, #64748b)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
              </dt>
              <dd style={{ margin: 0, fontSize: 13, color: "var(--body, #334155)", fontWeight: 500, lineHeight: 1.4 }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Progress donut */}
      <div
        style={{
          flexShrink: 0,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border, #e2e8f0)" strokeWidth="8" />
          <circle
            cx="32" cy="32" r="26"
            fill="none"
            stroke={col}
            strokeWidth="8"
            strokeDasharray={`${(pct / 100) * 163.4} 163.4`}
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
          />
          <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill={col}>
            {pct}%
          </text>
        </svg>
        <span style={{ fontSize: 11, color: "var(--muted, #64748b)", fontWeight: 500 }}>Onboarding</span>
      </div>
    </div>
  );
}
