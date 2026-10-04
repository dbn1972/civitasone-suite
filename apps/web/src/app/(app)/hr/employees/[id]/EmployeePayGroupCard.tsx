import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { LoaderResult } from "@/app/_data/apiClient";
import type { EmployeePayGroup, EmployeePayGroupEntry } from "../../payroll/pay-groups/payGroupData";
import { isBillType } from "../../payroll/pay-groups/payGroupMembership";

/**
 * The employee's current pay group on their profile (pay / compensation
 * section). A failed lookup renders an "unavailable" note -- never "not in
 * any pay group", which would claim something we could not verify.
 */
export function EmployeePayGroupCard({ result }: { result: Pick<LoaderResult<EmployeePayGroup | null>, "data" | "source"> }) {
  const t = useTranslations("employeePayGroup");
  const tm = useTranslations("payGroupMembers");
  const data = result.data;

  const billTypeText = (e: EmployeePayGroupEntry) => (isBillType(e.billType) ? tm(`billType.${e.billType}`) : "—");

  if (result.source === "error" || !data) {
    return (
      <Card title={t("title")} padding>
        <p role="status" style={{ margin: 0, color: "var(--mut, #64748b)" }}>{t("unavailable")}</p>
      </Card>
    );
  }

  const { current, history } = data;
  return (
    <Card title={t("title")} padding>
      {current ? (
        <div className="fields">
          <div className="fld">
            <span className="l">{t("fieldGroup")}</span>
            <span className="v">
              <Link href={`/hr/payroll/pay-groups/${current.payGroupId}`}>{current.payGroupName}</Link>
            </span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldDdo")}</span>
            <span className="v">{current.ddoCode ?? t("noDdo")}</span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldBillType")}</span>
            <span className="v">{billTypeText(current)}</span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldSince")}</span>
            <span className="v">{formatIndianDate(current.effectiveFrom)}</span>
          </div>
        </div>
      ) : (
        <p style={{ margin: 0 }}>{t("notAssigned")}</p>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>{t("historySummary")}</summary>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {history.map((h) => (
              <li key={`${h.payGroupId}-${h.effectiveFrom}`}>
                {t("historyRow", {
                  name: h.payGroupName,
                  from: formatIndianDate(h.effectiveFrom),
                  to: h.effectiveTo ? formatIndianDate(h.effectiveTo) : t("openEnded"),
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
