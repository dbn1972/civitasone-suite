"use client";
/**
 * APARFlowCard / APARFlowList — Sprint 14 / Lifecycle Phase 2
 * SPARROW-style 4-stage APAR pipeline:
 * Self-Appraisal → Reporting Officer → Counter-signing Officer → Acceptance / Dispute.
 * Active stage highlighted, deadline countdown shown on each card.
 */
import { formatIndianDate } from "@/lib/formatters";

export type AparRecord = {
  id: string;
  employeeId?: string;
  employeeName?: string;
  appraisalPeriod: string;
  status: string;
  overallBand?: string | null;
  overallGrade?: string | null;
  deadline?: string | null;
  updatedAt: string;
} & Record<string, unknown>;

interface Stage {
  key: string;
  label: string;
  icon: string;
  matchStatuses: string[];
}

const STAGES: Stage[] = [
  {
    key: "self",
    label: "Self-Appraisal",
    icon: "✍️",
    matchStatuses: ["initiated", "pending", "self_submitted"],
  },
  {
    key: "ro",
    label: "Reporting Officer",
    icon: "📋",
    matchStatuses: ["ro_review", "ro_submitted"],
  },
  {
    key: "cso",
    label: "Counter-signing Officer",
    icon: "🔍",
    matchStatuses: ["rv_submitted", "under_review", "cso_review"],
  },
  {
    key: "accept",
    label: "Acceptance / Dispute",
    icon: "✅",
    matchStatuses: ["accepted", "disputed", "closed"],
  },
];

function stageIndex(status: string): number {
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].matchStatuses.includes(status)) return i;
  }
  return 0;
}

function deadlineMeta(
  dl: string | null | undefined,
): { text: string; color: string } | null {
  if (!dl) return null;
  const days = Math.ceil((new Date(dl).getTime() - Date.now()) / 86_400_000);
  if (days < 0)  return { text: `${Math.abs(days)}d overdue`, color: "#dc2626" };
  if (days === 0) return { text: "Due today",                 color: "#dc2626" };
  if (days <= 7)  return { text: `${days}d left`,             color: "#b45309" };
  return { text: `${days}d left`,                             color: "#2563eb" };
}

function APARCard({ record }: { record: AparRecord }) {
  const si         = stageIndex(record.status);
  const dl         = deadlineMeta(record.deadline);
  const empLabel   = record.employeeName ?? record.employeeId ?? "Unknown";
  const isDisputed = record.status === "disputed";
  const isClosed   = record.status === "closed" || record.status === "accepted";

  return (
    <article
      className="card"
      style={{ marginBottom: 0 }}
      aria-label={`APAR for ${empLabel}, period ${record.appraisalPeriod}`}
    >
      {/* Header */}
      <div className="card-h" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            Period: <strong>{record.appraisalPeriod}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {record.overallBand && (
            <span
              style={{
                padding: "2px 10px", borderRadius: 12,
                background: "#e6f0ff", color: "#1d4ed8",
                fontSize: "0.75rem", fontWeight: 700,
              }}
            >
              Band: {record.overallBand}
            </span>
          )}
          {dl && (
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: dl.color }}>
              ⏰ {dl.text}
            </span>
          )}
        </div>
      </div>

      {/* Stage pipeline */}
      <div
        style={{
          display: "flex", alignItems: "flex-start",
          margin: "16px 16px 14px",
          position: "relative",
        }}
        role="list"
        aria-label="APAR workflow stages"
      >
        {/* Connector line */}
        <div
          aria-hidden
          style={{
            position: "absolute", top: 16,
            left: "calc(50% / 4)", right: "calc(50% / 4)",
            height: 2, background: "var(--line, #e2e8f0)", zIndex: 0,
          }}
        />

        {STAGES.map((stage, i) => {
          const isDone    = i < si || isClosed;
          const isActive  = i === si && !isClosed;
          const isDisp    = isDisputed && i === STAGES.length - 1;

          return (
            <div
              key={stage.key}
              role="listitem"
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 6,
                position: "relative", zIndex: 1,
              }}
            >
              {/* Bubble */}
              <div
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: isDisp
                    ? "#fef2f2"
                    : isDone
                    ? "#f0fdf4"
                    : isActive
                    ? "var(--primary, #2563eb)"
                    : "var(--bg2, #f1f5f9)",
                  border: `2px solid ${
                    isDisp
                      ? "#dc2626"
                      : isDone
                      ? "#16a34a"
                      : isActive
                      ? "var(--primary, #2563eb)"
                      : "var(--line, #e2e8f0)"
                  }`,
                  color: isDisp
                    ? "#dc2626"
                    : isDone
                    ? "#16a34a"
                    : isActive
                    ? "#fff"
                    : "var(--ink3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15,
                  boxShadow: isActive ? "0 0 0 4px #dbeafe" : "none",
                  transition: "all 0.2s",
                }}
                aria-label={`${stage.label}: ${
                  isDone ? "done" : isActive ? "active" : "pending"
                }`}
              >
                {isDisp ? "⚠" : isDone ? "✓" : stage.icon}
              </div>

              {/* Stage label */}
              <span
                style={{
                  fontSize: "0.625rem", textAlign: "center", lineHeight: 1.3,
                  color: isActive
                    ? "var(--primary, #1d4ed8)"
                    : isDone
                    ? "#16a34a"
                    : "var(--ink3)",
                  fontWeight: isActive ? 600 : 400,
                  maxWidth: 66,
                }}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 16px 12px",
          borderTop: "1px solid var(--line, #e2e8f0)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: "0.75rem", color: "var(--ink3)",
        }}
      >
        <span>
          Stage:&nbsp;
          <strong style={{ color: isDisputed ? "#dc2626" : "var(--ink)" }}>
            {isDisputed
              ? "⚠️ Disputed"
              : isClosed
              ? "✅ Closed"
              : (STAGES[si]?.label ?? record.status)}
          </strong>
        </span>
        <span>Updated {formatIndianDate(record.updatedAt)}</span>
      </div>
    </article>
  );
}

interface ListProps { records: AparRecord[] }

export function APARFlowList({ records }: ListProps) {
  if (records.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          No APAR records found
        </p>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
      }}
    >
      {records.map((r) => (
        <APARCard key={r.id} record={r} />
      ))}
    </div>
  );
}
