"use client";
/**
 * RetirementDashboard — Sprint 14 / Lifecycle Phase 2
 * Card grid of employees retiring in the next 6 months, sorted by date ascending.
 * Each card: name, designation, retirement date (Indian dd/MM/yyyy), years of service,
 * clearance status chips (Library / Store / IT / Finance).
 */
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type RetirementRow = {
  id: string;
  employee: string;
  designation?: string;
  department?: string;
  superannuationDate: string;
  separationType?: string;
  joiningDate?: string;
  yearsOfService?: number;
  clearanceLibrary?: "pending" | "cleared" | "na";
  clearanceStore?: "pending" | "cleared" | "na";
  clearanceIT?: "pending" | "cleared" | "na";
  clearanceFinance?: "pending" | "cleared" | "na";
  status: string;
} & Record<string, unknown>;

const CLEARANCE_DEPTS: Array<{ key: keyof RetirementRow; label: string }> = [
  { key: "clearanceLibrary",  label: "Library" },
  { key: "clearanceStore",    label: "Store" },
  { key: "clearanceIT",       label: "IT" },
  { key: "clearanceFinance",  label: "Finance" },
];

function ClearanceChip({ status, label }: { status: string; label: string }) {
  const variants: Record<string, { bg: string; color: string; prefix: string }> = {
    cleared: { bg: "#f0fdf4", color: "#16a34a", prefix: "✅" },
    pending: { bg: "#fffbe6", color: "#b45309", prefix: "⏳" },
    na:      { bg: "#f8fafc", color: "#64748b", prefix: "—" },
  };
  const v = variants[status] ?? variants.pending;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 10px", borderRadius: 20, fontSize: "0.75rem",
        fontWeight: 500, background: v.bg, color: v.color,
      }}
    >
      {v.prefix} {label}
    </span>
  );
}

function calcYOS(row: RetirementRow): number {
  if (row.yearsOfService) return Number(row.yearsOfService);
  if (row.joiningDate) {
    const ms = new Date(row.superannuationDate).getTime() - new Date(row.joiningDate).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
  }
  return 0;
}

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function borderColor(days: number): string {
  if (days <= 30) return "#dc2626";
  if (days <= 90) return "#f59e0b";
  return "#2563eb";
}

interface Props {
  rows: RetirementRow[];
  /** Currently selected retiree (for the processing wizard below), if any. */
  selectedId?: string;
  /** Called when the officer picks a retiree to process. */
  onSelect?: (row: RetirementRow) => void;
}

export function RetirementDashboard({ rows, selectedId, onSelect }: Props) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + 6);
  const upcoming = rows
    .filter((r) => {
      if (!r.superannuationDate) return false;
      const d = new Date(r.superannuationDate);
      return d >= new Date() && d <= cutoff;
    })
    .sort(
      (a, b) =>
        new Date(a.superannuationDate).getTime() - new Date(b.superannuationDate).getTime(),
    );

  if (upcoming.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>👴</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          No retirements in the next 6 months
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--ink3)" }}>
          Employees retiring beyond 6 months appear in the full register below.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid", gap: 14,
        gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
      }}
    >
      {upcoming.map((row) => {
        const days = daysLeft(row.superannuationDate);
        const yos  = calcYOS(row);
        const selected = row.id === selectedId;
        return (
          <article
            key={row.id}
            className="card"
            style={{
              marginBottom: 0,
              borderLeft: `4px solid ${borderColor(days)}`,
              outline: selected ? "2px solid var(--primary, #2563eb)" : "none",
              outlineOffset: -1,
            }}
            aria-label={`Retirement: ${row.employee}`}
            aria-current={selected ? "true" : undefined}
          >
            {/* Header */}
            <div className="card-h" style={{ alignItems: "flex-start", gap: 10 }}>
              <div
                aria-hidden
                style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: "#e6f0ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, flexShrink: 0,
                }}
              >
                👴
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
              <StatusPill status={row.status} />
            </div>

            {/* Key facts */}
            <dl
              style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "8px 16px", margin: "12px 16px 0", padding: 0,
                fontSize: "0.8125rem",
              }}
            >
              <div>
                <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Retirement Date</dt>
                <dd
                  style={{
                    margin: 0, fontWeight: 600,
                    color: days <= 30 ? "#dc2626" : "var(--ink)",
                  }}
                >
                  {formatIndianDate(row.superannuationDate)}
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Days Remaining</dt>
                <dd
                  style={{
                    margin: 0, fontWeight: 600,
                    color: days <= 30 ? "#dc2626" : days <= 90 ? "#b45309" : "var(--ink)",
                  }}
                >
                  {days} days
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Years of Service</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>
                  {yos > 0 ? `${yos} years` : "—"}
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--ink3)", marginBottom: 2 }}>Type</dt>
                <dd style={{ margin: 0 }}>{row.separationType ?? "Superannuation"}</dd>
              </div>
            </dl>

            {/* Clearance chips */}
            <div
              style={{
                padding: "10px 16px 14px",
                marginTop: 12,
                borderTop: "1px solid var(--line, #e2e8f0)",
              }}
            >
              <p
                style={{
                  margin: "0 0 8px", fontSize: "0.6875rem",
                  color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.06em",
                }}
              >
                Pending Clearances
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {CLEARANCE_DEPTS.map(({ key, label }) => (
                  <ClearanceChip
                    key={key}
                    label={label}
                    status={String(row[key] ?? "pending")}
                  />
                ))}
              </div>
            </div>
            {onSelect && (
              <div style={{ padding: "0 16px 14px" }}>
                <button
                  type="button"
                  className={selected ? "btn primary" : "btn ghost"}
                  style={{ width: "100%", minHeight: 40, fontSize: "0.8125rem" }}
                  aria-pressed={selected}
                  onClick={() => onSelect(row)}
                >
                  {selected ? "✓ Processing this retirement" : "Process this retirement →"}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
