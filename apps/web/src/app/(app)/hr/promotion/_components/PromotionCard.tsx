"use client";
/**
 * PromotionCard — Sprint 13 / Lifecycle Phase 1
 * Shows: current designation → new designation (with arrow), effective date,
 * DPC meeting date, order number, increment in pay. Approval chain:
 * Dept Head → HR → Finance → Signed.
 */
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

export type PromotionRow = {
  id: string;
  employee?: string;
  employeeId?: string;
  department?: string;
  fromGrade?: string;
  toGrade?: string;
  fromDesignation?: string;
  toDesignation?: string;
  fromDesigId?: string;
  toDesigId?: string;
  effectiveDate?: string | null;
  dpcDate?: string | null;
  orderNo?: string | null;
  orderRef?: string | null;
  newBasicMinor?: number | null;
  status: string;
  createdAt?: string;
} & Record<string, unknown>;

const STATUS_LABEL: Record<string, string> = {
  pending: "Initiated",
  dept_approved: "Dept Head Approved",
  hr_approved: "HR Approved",
  finance_approved: "Finance Approved",
  approved: "Finance Approved",
  signed: "Signed & Issued",
  completed: "Completed",
  cancelled: "Cancelled",
};

const CHAIN: Array<{ key: string; label: string; icon: string }> = [
  { key: "dept_approved",    label: "Dept Head", icon: "🏢" },
  { key: "hr_approved",      label: "HR",        icon: "👥" },
  { key: "finance_approved", label: "Finance",   icon: "💰" },
  { key: "signed",           label: "Signed",    icon: "✍️" },
];

function chainIndex(status: string): number {
  const map: Record<string, number> = {
    pending: -1,
    dept_approved: 0,
    hr_approved: 1,
    finance_approved: 2, approved: 2,
    signed: 3, completed: 3,
  };
  return map[status] ?? -1;
}

interface Props { promotion: PromotionRow; }

export function PromotionCard({ promotion }: Props) {
  const statusLabel = STATUS_LABEL[promotion.status] ?? promotion.status;
  const chainIdx    = chainIndex(promotion.status);
  const empLabel    = promotion.employee ?? promotion.employeeId ?? "Unknown";
  const fromLabel   = promotion.fromDesignation ?? promotion.fromGrade ?? promotion.fromDesigId ?? "—";
  const toLabel     = promotion.toDesignation   ?? promotion.toGrade   ?? promotion.toDesigId   ?? "—";
  const payStr      = promotion.newBasicMinor != null
    ? formatMoney(Number(promotion.newBasicMinor))
    : null;

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={`Promotion for ${empLabel}`}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          {promotion.department && (
            <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>{promotion.department}</p>
          )}
        </div>
        <StatusPill status={promotion.status} label={statusLabel} />
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        {/* Designation progression */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", background: "var(--panel, #f8fafc)",
          borderRadius: 10, marginBottom: 14, flexWrap: "wrap",
        }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Current</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.9375rem", fontWeight: 600 }}>{fromLabel}</p>
          </div>
          <div style={{ fontSize: 22, color: "#2563eb", flexShrink: 0 }}>&#8594;</div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Promoted To</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.9375rem", fontWeight: 700, color: "#16a34a" }}>{toLabel}</p>
          </div>
          {payStr && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>New Basic</p>
              <p style={{ margin: "4px 0 0", fontSize: "1rem", fontWeight: 700, color: "#0f766e" }}>{payStr}</p>
            </div>
          )}
        </div>

        {/* Key fields */}
        <div className="fields">
          {(promotion.orderNo ?? promotion.orderRef) && (
            <div className="fld">
              <span className="l">Order No.</span>
              <span className="v" style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
                {promotion.orderNo ?? promotion.orderRef}
              </span>
            </div>
          )}
          {promotion.effectiveDate && (
            <div className="fld">
              <span className="l">Effective Date</span>
              <span className="v">{formatIndianDate(promotion.effectiveDate)}</span>
            </div>
          )}
          {promotion.dpcDate && (
            <div className="fld">
              <span className="l">DPC Meeting Date</span>
              <span className="v">{formatIndianDate(promotion.dpcDate)}</span>
            </div>
          )}
        </div>

        {/* Approval chain */}
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", color: "var(--ink3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Approval Chain
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHAIN.map(({ key, label, icon }, i) => {
              const done   = i <= chainIdx;
              const active = i === chainIdx + 1;
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 20, border: "1px solid",
                  borderColor: done ? "#16a34a" : active ? "#2563eb" : "var(--line)",
                  background:  done ? "#f0fdf4" : active ? "#eff6ff" : "transparent",
                  fontSize: "0.8125rem", fontWeight: done || active ? 600 : 400,
                  color: done ? "#16a34a" : active ? "#2563eb" : "var(--ink3)",
                }}>
                  <span>{done ? "✓" : icon}</span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
