import { useTranslations } from "next-intl";
import { Card, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export interface ContractProjectFields {
  contractId?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  contractStatus?: string;
  contractRenewalCount?: number;
  primaryProjectId?: string;
  projectCode?: string;
  projectName?: string;
}

const KNOWN_STATUS = ["active", "expiring", "escalated", "expired", "renewed", "terminated"] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];
const isKnown = (s: string): s is KnownStatus => (KNOWN_STATUS as readonly string[]).includes(s);

function statusVariant(s: string): "good" | "warn" | "bad" | "mut" {
  if (s === "active" || s === "renewed") return "good";
  if (s === "expiring") return "warn";
  if (s === "escalated" || s === "expired") return "bad";
  return "mut";
}

/** Whole days from today (IST calendar is close enough for a badge; the server alerts use exact dates). */
export function daysUntil(endDate: string, today: Date = new Date()): number {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((end - t) / 86_400_000);
}

/**
 * S8 G5: "Contract and project" on the employee profile. These are read-only projections of the contracts module
 * and the project reference (the server fills them only for tenants that opted in), so the card renders nothing at
 * all when the record carries no contract: an existing tenant's profile page is unchanged. Changes are made in the
 * contracts module (renew / terminate), never here.
 */
export function EmployeeContractCard(props: { employee: ContractProjectFields; projectManagerName?: string | null; costCenterName?: string | null }) {
  const { employee, projectManagerName, costCenterName } = props;
  const t = useTranslations("employeeContract");
  if (!employee.contractId) return null;

  const status = employee.contractStatus ?? "";
  const remaining = employee.contractEndDate && (status === "active" || status === "expiring" || status === "escalated")
    ? daysUntil(employee.contractEndDate)
    : null;

  return (
    <Card title={t("title")} padding>
      <div className="fields">
        {employee.contractStatus && (
          <div className="fld">
            <span className="l">{t("fieldStatus")}</span>
            <span className="v">
              <StatusPill status={status} variant={statusVariant(status)} label={isKnown(status) ? t(`status.${status}`) : status} />
            </span>
          </div>
        )}
        {employee.contractStartDate && (
          <div className="fld">
            <span className="l">{t("fieldStart")}</span>
            <span className="v">{formatIndianDate(employee.contractStartDate)}</span>
          </div>
        )}
        {employee.contractEndDate && (
          <div className="fld">
            <span className="l">{t("fieldEnd")}</span>
            <span className="v">
              {formatIndianDate(employee.contractEndDate)}
              {remaining !== null && (
                <span style={{ marginInlineStart: 8, color: remaining <= 30 ? "var(--bad)" : "var(--mut)" }}>
                  {remaining >= 0 ? t("daysLeft", { count: remaining }) : t("daysOver", { count: -remaining })}
                </span>
              )}
            </span>
          </div>
        )}
        {typeof employee.contractRenewalCount === "number" && (
          <div className="fld">
            <span className="l">{t("fieldRenewals")}</span>
            <span className="v">{employee.contractRenewalCount}</span>
          </div>
        )}
        {(employee.projectCode || employee.projectName) && (
          <div className="fld">
            <span className="l">{t("fieldProject")}</span>
            <span className="v">{[employee.projectCode, employee.projectName].filter(Boolean).join(" - ")}</span>
          </div>
        )}
        {projectManagerName && (
          <div className="fld">
            <span className="l">{t("fieldProjectManager")}</span>
            <span className="v">{projectManagerName}</span>
          </div>
        )}
        {costCenterName && (
          <div className="fld">
            <span className="l">{t("fieldCostCenter")}</span>
            <span className="v">{costCenterName}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
