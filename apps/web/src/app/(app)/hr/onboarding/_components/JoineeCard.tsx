/**
 * JoineeCard — manager-view card for a single joinee.
 * Shows progress bar, overdue count (highlighted amber), and quick-link to detail.
 */

import Link from "next/link";
import { ProgressBar, StatusPill } from "../../../../_components/ds";

export interface JoineeCardData {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  stepsCompleted: number;
  totalSteps: number;
  overdue: number;
  progress: number;   // 0–100
  status: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
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
        border: `1px solid ${isOverdue ? "#fde68a" : "var(--border, #e2e8f0)"}`,
        borderRadius: 10,
        padding: 16,
        background: isOverdue ? "#fffcf0" : "var(--card-bg, #fff)",
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
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {initials(employee)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--heading, #1e293b)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {employee}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>{department}</div>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: 11,
          color: "var(--muted, #64748b)",
          flexWrap: "wrap",
        }}
      >
        <span>Joining: <strong style={{ color: "var(--body, #334155)" }}>{formatDate(joiningDate)}</strong></span>
        <span>Steps: <strong style={{ color: "var(--body, #334155)" }}>{stepsCompleted}/{totalSteps}</strong></span>
        {isOverdue && (
          <span
            data-testid={`overdue-badge-${id}`}
            style={{
              padding: "1px 7px",
              borderRadius: 99,
              background: "#fef3c7",
              color: "#92400e",
              fontWeight: 700,
              border: "1px solid #fde68a",
            }}
          >
            ⚠ {overdue} overdue
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted, #64748b)", marginBottom: 4 }}>
          <span>Progress</span>
          <span style={{ fontWeight: 700, color: pct === 100 ? "#16a34a" : "var(--body, #334155)" }}>{pct}%</span>
        </div>
        <ProgressBar value={pct} color={isOverdue ? "#d97706" : undefined} />
      </div>

      {/* View detail link */}
      <Link
        href={`/hr/onboarding/${id}`}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#4f46e5",
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
