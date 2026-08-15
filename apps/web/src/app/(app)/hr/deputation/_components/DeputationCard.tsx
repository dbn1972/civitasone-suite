"use client";
/**
 * DeputationCard — Sprint 13 / Lifecycle Phase 1
 * Shows: deputed-to organisation, start date, expected end date,
 * revised compensation (if any), recall status.
 * Government agency names are pre-filled via a select list.
 */
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

// Standard Indian government organisations pre-filled in the select
export const GOV_AGENCIES = [
  "Ministry of Finance",
  "Ministry of Home Affairs",
  "Ministry of Personnel, Public Grievances and Pensions",
  "Ministry of Electronics and Information Technology",
  "Ministry of Health and Family Welfare",
  "Ministry of Defence",
  "Ministry of External Affairs",
  "Ministry of Commerce and Industry",
  "Ministry of Education",
  "Ministry of Agriculture and Farmers Welfare",
  "Ministry of Rural Development",
  "Ministry of Housing and Urban Affairs",
  "Ministry of Railways",
  "Ministry of Road Transport and Highways",
  "National Informatics Centre (NIC)",
  "National Institute of Smart Government (NISG)",
  "Securities and Exchange Board of India (SEBI)",
  "Reserve Bank of India (RBI)",
  "Comptroller and Auditor General of India (CAG)",
  "Union Public Service Commission (UPSC)",
  "Central Vigilance Commission (CVC)",
  "State Government",
  "Public Sector Undertaking (PSU)",
  "Other Central Government Ministry / Dept",
];

export type DeputationRow = {
  id: string;
  employee?: string;
  employeeId?: string;
  parentOrg?: string;
  deputationOrg?: string;
  fromDate?: string | null;
  toDate?: string | null;
  period?: string;
  revisedCompensationMinor?: number | null;
  recallStatus?: string | null;
  status: string;
  createdAt?: string;
} & Record<string, unknown>;

const STATUS_LABEL: Record<string, string> = {
  active:    "Active",
  pending:   "Pending",
  completed: "Completed",
  recalled:  "Recalled",
  cancelled: "Cancelled",
  expired:   "Expired",
};

interface Props { deputation: DeputationRow; }

export function DeputationCard({ deputation }: Props) {
  const statusLabel = STATUS_LABEL[deputation.status] ?? deputation.status;
  const empLabel    = deputation.employee ?? deputation.employeeId ?? "Unknown";
  const toOrg       = deputation.deputationOrg ?? "—";
  const fromOrg     = deputation.parentOrg ?? "—";

  const today = new Date();
  let daysLeft: number | null = null;
  if (deputation.toDate && deputation.status === "active") {
    const end = new Date(deputation.toDate);
    daysLeft  = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  }

  const revComp = deputation.revisedCompensationMinor != null
    ? formatMoney(Number(deputation.revisedCompensationMinor))
    : null;

  const isRecalled = deputation.status === "recalled" || deputation.recallStatus === "initiated";

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={`Deputation for ${empLabel}`}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {fromOrg} &rarr; {toOrg}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <StatusPill status={deputation.status} label={statusLabel} />
          {isRecalled && (
            <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 600 }}>
              ↩ Recall Initiated
            </span>
          )}
        </div>
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        {/* Deputation-to highlighted block */}
        <div style={{
          padding: "10px 14px", background: "var(--panel, #f8fafc)",
          borderRadius: 8, marginBottom: 12, borderLeft: "3px solid #2563eb",
        }}>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Deputed to
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "1rem", fontWeight: 600 }}>{toOrg}</p>
        </div>

        <div className="fields">
          {deputation.fromDate && (
            <div className="fld">
              <span className="l">Start Date</span>
              <span className="v">{formatIndianDate(deputation.fromDate)}</span>
            </div>
          )}
          {deputation.toDate && (
            <div className="fld">
              <span className="l">Expected End Date</span>
              <span className="v">
                {formatIndianDate(deputation.toDate)}
                {daysLeft !== null && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.75rem", fontWeight: 600,
                    color: daysLeft < 30 ? "#dc2626" : daysLeft < 90 ? "#d97706" : "#16a34a",
                  }}>
                    ({daysLeft > 0 ? `${daysLeft}d left` : "Overdue"})
                  </span>
                )}
              </span>
            </div>
          )}
          {deputation.period && (
            <div className="fld">
              <span className="l">Period</span>
              <span className="v">{deputation.period}</span>
            </div>
          )}
          {revComp && (
            <div className="fld">
              <span className="l">Revised Compensation</span>
              <span className="v" style={{ fontWeight: 600, color: "#0f766e" }}>{revComp}</span>
            </div>
          )}
          {deputation.recallStatus && (
            <div className="fld">
              <span className="l">Recall Status</span>
              <span className="v">{deputation.recallStatus}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
