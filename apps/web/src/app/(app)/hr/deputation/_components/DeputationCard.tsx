"use client";
/**
 * DeputationCard — Sprint 13 / Lifecycle Phase 1
 * Shows: deputed-to organisation, start date, expected end date, the
 * deputation (duty) allowance, and (active-only) repatriate/cancel actions.
 *
 * GAP-HR-DEPUTATION-01/03/05/06 fixes, folded together since they all touch
 * this same small file:
 *  - status vocabulary matches the real backend enum (active|repatriated|
 *    cancelled) -- the old "recalled"/recallStatus concept never existed on
 *    the backend and is removed rather than left as dead UI.
 *  - revisedCompensationMinor (never sent by the list route) is replaced by
 *    deputationAllowanceMinor, which the backend actually stores and now
 *    actually returns (see GAP-HR-DEPUTATION-03's fix in m7-list-routes.ts).
 *  - the days-left urgency cue no longer relies on a hard-coded hex colour
 *    alone (a text cue was already present; the colour now uses a design
 *    token like its own sibling branches).
 *  - every label is now translated (useTranslations) instead of hard-coded
 *    English inside a "use client" component that otherwise lives in a
 *    fully next-intl'd page.
 */
import { useTranslations } from "next-intl";
import { StatusPill } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { DeputationActions } from "./DeputationActions";

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
  deputationAllowanceMinor?: string | number | null;
  status: string;
  createdAt?: string;
} & Record<string, unknown>;

interface Props {
  deputation: DeputationRow;
  /** Mirrors deputation/routes.ts's own HR_ROLES for repatriate/cancel. */
  canManage?: boolean;
}

const KNOWN_STATUSES = new Set(["active", "repatriated", "cancelled"]);

export function DeputationCard({ deputation, canManage = false }: Props) {
  const t = useTranslations("deputation");
  const statusLabel = KNOWN_STATUSES.has(deputation.status) ? t(`card.status.${deputation.status}`) : deputation.status;
  const empLabel    = deputation.employee ?? deputation.employeeId ?? t("card.unknownEmployee");
  const toOrg       = deputation.deputationOrg ?? "—";
  const fromOrg     = deputation.parentOrg ?? "—";

  const today = new Date();
  let daysLeft: number | null = null;
  if (deputation.toDate && deputation.status === "active") {
    const end = new Date(deputation.toDate);
    daysLeft  = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  }

  const allowance = deputation.deputationAllowanceMinor != null
    ? formatMoney(deputation.deputationAllowanceMinor as bigint | number | string)
    : null;

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={t("card.ariaLabel", { name: empLabel })}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {fromOrg} &rarr; {toOrg}
          </p>
        </div>
        <StatusPill status={deputation.status} label={statusLabel} />
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        {/* Deputation-to highlighted block */}
        <div style={{
          padding: "10px 14px", background: "var(--panel, #f8fafc)",
          borderRadius: 8, marginBottom: 12, borderInlineStart: "3px solid var(--info, #2563eb)",
        }}>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {t("card.deputedTo")}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "1rem", fontWeight: 600 }}>{toOrg}</p>
        </div>

        <div className="fields">
          {deputation.fromDate && (
            <div className="fld">
              <span className="l">{t("card.startDate")}</span>
              <span className="v">{formatIndianDate(deputation.fromDate)}</span>
            </div>
          )}
          {deputation.toDate && (
            <div className="fld">
              <span className="l">{t("card.expectedEnd")}</span>
              <span className="v">
                {formatIndianDate(deputation.toDate)}
                {daysLeft !== null && (
                  <span style={{
                    marginInlineStart: 8, fontSize: "0.75rem", fontWeight: 600,
                    color: daysLeft < 30 ? "var(--bad, #dc2626)" : daysLeft < 90 ? "var(--warn, #d97706)" : "var(--good, #15803d)",
                  }}>
                    ({daysLeft > 0 ? t("card.daysLeft", { days: daysLeft }) : t("card.overdue")})
                  </span>
                )}
              </span>
            </div>
          )}
          {deputation.period && (
            <div className="fld">
              <span className="l">{t("card.period")}</span>
              <span className="v">{deputation.period}</span>
            </div>
          )}
          {allowance && (
            <div className="fld">
              <span className="l">{t("card.allowance")}</span>
              <span className="v" style={{ fontWeight: 600, color: "var(--good, #0f766e)" }}>{allowance}</span>
            </div>
          )}
        </div>

        {deputation.status === "active" && canManage && (
          <div style={{ marginTop: 12 }}>
            <DeputationActions id={deputation.id} employeeLabel={empLabel} />
          </div>
        )}
      </div>
    </div>
  );
}
