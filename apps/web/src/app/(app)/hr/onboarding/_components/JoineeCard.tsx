/**
 * JoineeCard — manager-view card for a single joinee.
 * Shows progress bar, overdue count (highlighted amber), and quick-link to detail.
 */

import Link from "next/link";
import { ProgressBar, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export interface JoineeCardData {
  id: string;
  employee: string;
  department: string;
  /** ISO date string, or null when the backend couldn't resolve one (GAP-HR-ONBOARDING-04). */
  joiningDate: string | null;
  stepsCompleted: number;
  totalSteps: number;
  overdue: number;
  progress: number;   // 0–100
  status: string;
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function JoineeCard({
  id,
  employee,
  department,
  joiningDate,
  stepsCompleted,
  totalSteps,
  overdue,
  progress,
  status,
}: JoineeCardData) {
  const pct = Math.min(100, Math.max(0, progress));
  const isOverdue = overdue > 0;

  return (
    <div
      data-testid={`joinee-card-${id}`}
      style={{
        border: `1px solid ${isOverdue ? "var(--warnbd)" : "var(--border)"}`,
        borderRadius: 10,
        padding: 16,
        background: isOverdue ? "var(--warnbg)" : "var(--card-bg)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "box-shadow 0.15s",
      }}
    >
      {/* Top row: avatar + name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          aria-hidden
          style={{
            flexShrink: 0,
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "linear-gradient(135deg,var(--indigo),var(--violet))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--panel)",
          }}
        >
          {initials(employee)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {employee}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{department}</div>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: 11,
          color: "var(--muted)",
          flexWrap: "wrap",
        }}
      >
        <span>Joining: <strong style={{ color: "var(--body)" }}>{formatIndianDate(joiningDate)}</strong></span>
        <span>Steps: <strong style={{ color: "var(--body)" }}>{stepsCompleted}/{totalSteps}</strong></span>
        {isOverdue && (
          <span
            data-testid={`overdue-badge-${id}`}
            style={{
              padding: "1px 7px",
              borderRadius: 99,
              background: "var(--warnbg)",
              color: "var(--warn)",
              fontWeight: 700,
              border: "1px solid var(--warnbd)",
            }}
          >
            ⚠ {overdue} overdue
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
          <span>Progress</span>
          <span style={{ fontWeight: 700, color: pct === 100 ? "var(--good)" : "var(--body)" }}>{pct}%</span>
        </div>
        <ProgressBar value={pct} color={isOverdue ? "var(--warn)" : undefined} />
      </div>

      {/* View detail link */}
      <Link
        href={`/hr/onboarding/${id}`}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--indigo)",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        aria-label={`View onboarding details for ${employee}`}
      >
        View details →
      </Link>
    </div>
  );
}
