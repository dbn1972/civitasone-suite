"use client";
/**
 * ProbationConfirmationCard / ProbationConfirmationList — Sprint 14 / Lifecycle Phase 2
 * Card grid for employees due for confirmation after 2-year probation (CCS Rules).
 * Each card: probation start, due date, manager recommendation badge, Confirm/Extend buttons.
 * Optimistic local UI — no API mutation in Phase 2.
 */
import { useState } from "react";
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type ConfirmationRow = {
  id: string;
  employee: string;
  department?: string;
  designation?: string;
  joiningDate: string;
  probationEnd: string;
  dueDate: string;
  managerRecommendation?: "recommended" | "not_recommended" | "pending" | null;
  status: string;
} & Record<string, unknown>;

type LocalAction = "default" | "confirmed" | "extended";

function daysDiff(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function dueMeta(days: number): { label: string; color: string } {
  if (days < 0)   return { label: `${Math.abs(days)}d overdue`, color: "#dc2626" };
  if (days === 0) return { label: "Due today",                  color: "#dc2626" };
  if (days <= 7)  return { label: `Due in ${days}d`,            color: "#b45309" };
  if (days <= 30) return { label: `Due in ${days}d`,            color: "#d97706" };
  return { label: `Due in ${days}d`,                            color: "#2563eb" };
}

const REC_CONFIG: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  recommended:     { label: "Recommended",      badge: "👍", color: "#16a34a", bg: "#f0fdf4" },
  not_recommended: { label: "Not Recommended",  badge: "👎", color: "#dc2626", bg: "#fef2f2" },
  pending:         { label: "Awaiting Manager", badge: "⏳", color: "#b45309", bg: "#fffbe6" },
};

function ProbationCard({ row }: { row: ConfirmationRow }) {
  const [action, setAction] = useState<LocalAction>("default");
  const days = daysDiff(row.dueDate);
  const due  = dueMeta(days);
  const rec  = REC_CONFIG[row.managerRecommendation ?? "pending"] ?? REC_CONFIG.pending;

  const isActionable =
    action === "default" &&
    row.status !== "confirmed" &&
    row.status !== "extended";

  return (
    <article
      className="card"
      style={{
        marginBottom: 0,
        borderLeft: `4px solid ${days < 0 ? "#dc2626" : days <= 14 ? "#f59e0b" : "var(--line, #e2e8f0)"}`,
      }}
      aria-label={`Probation confirmation for ${row.employee}`}
    >
      {/* Header */}
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div
          aria-hidden
          style={{
            width: 40, height: 40, borderRadius: "50%", background: "#eff6ff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}
        >
          👤
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>
            {row.employee}
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {row.designation ?? "—"}
            {row.department ? ` · ${row.department}` : ""}
          </p>
        </div>
        {action !== "default" ? (
          <span
            style={{
              padding: "3px 12px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 600,
              background: action === "confirmed" ? "#f0fdf4" : "#fffbe6",
              color:      action === "confirmed" ? "#16a34a" : "#b45309",
            }}
          >
            {action === "confirmed" ? "✅ Confirmed" : "🔄 Extended"}
          </span>
        ) : (
          <StatusPill status={row.status} />
        )}
      </div>

      {/* Key dates */}
      <dl
        style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px", margin: "12px 16px 0", padding: 0,
          fontSize: "0.8125rem",
        }}
      >
        <div>
          <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Probation Start</dt>
          <dd style={{ margin: 0, fontWeight: 500 }}>{formatIndianDate(row.joiningDate)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Probation End</dt>
          <dd style={{ margin: 0, fontWeight: 500 }}>{formatIndianDate(row.probationEnd)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Confirmation Due</dt>
          <dd style={{ margin: 0, fontWeight: 600, color: due.color }}>
            {formatIndianDate(row.dueDate)}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Deadline</dt>
          <dd style={{ margin: 0, fontWeight: 600, color: due.color }}>{due.label}</dd>
        </div>
      </dl>

      {/* Manager recommendation + action buttons */}
      <div
        style={{
          padding: "10px 16px 14px", marginTop: 12,
          borderTop: "1px solid var(--line, #e2e8f0)",
          display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 10, flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: 20,
            background: rec.bg, color: rec.color,
            fontSize: "0.8125rem", fontWeight: 500,
          }}
        >
          <span>{rec.badge}</span>
          <span>{rec.label}</span>
        </div>

        {isActionable && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setAction("confirmed")}
              style={{
                padding: "6px 16px", borderRadius: 6, border: "none",
                background: "#16a34a", color: "#fff",
                fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
              }}
              aria-label={`Confirm ${row.employee}`}
            >
              Confirm
            </button>
            <button
              onClick={() => setAction("extended")}
              style={{
                padding: "6px 16px", borderRadius: 6,
                border: "1px solid var(--line, #e2e8f0)",
                background: "var(--bg2, #f8fafc)",
                fontSize: "0.8125rem", fontWeight: 500,
                cursor: "pointer", color: "var(--ink)",
              }}
              aria-label={`Extend probation for ${row.employee}`}
            >
              Extend
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

interface ListProps { rows: ConfirmationRow[] }

export function ProbationConfirmationList({ rows }: ListProps) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          No employees currently on probation
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8125rem" }}>
          Employees in their 2-year probation period appear here once added to the service book.
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
      {rows.map((row) => (
        <ProbationCard key={row.id} row={row} />
      ))}
    </div>
  );
}
