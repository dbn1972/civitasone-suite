import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card } from "../../../../_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import type { LoaderResult } from "@/app/_data/apiClient";
import { isDependantRelation, isSchemeType, type MedicalInsurance } from "./insuranceTypes";

/**
 * Medical insurance / health scheme (CGHS, state scheme, group mediclaim,
 * ESIC) of one employee: on the HR employee profile and in the employee's own
 * "My medical insurance" self-service card.
 *
 * The card number arrives already masked by hrms-service for anyone who is
 * not HR or the employee themself; this component only renders what it is
 * given. A failed read is "unavailable" -- never "no record on file", which
 * would claim something we could not verify. `children` is where an HR edit
 * form goes (the caller decides who may edit).
 */
export function MedicalInsuranceCard({
  result,
  title,
  children,
}: {
  result: Pick<LoaderResult<MedicalInsurance | null>, "data" | "source" | "status">;
  title?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("medicalInsurance");
  const heading = title ?? t("title");

  if (result.source === "error") {
    return (
      <Card title={heading} padding>
        <p role="status" style={{ margin: 0, color: "var(--mut)" }}>
          {result.status === 403 ? t("forbidden") : t("unavailable")}
        </p>
      </Card>
    );
  }

  const d = result.data;
  if (!d) {
    return (
      <Card title={heading} padding>
        <p style={{ margin: 0 }}>{t("noRecord")}</p>
        {children}
      </Card>
    );
  }

  const schemeLabel = isSchemeType(d.schemeType) ? t(`schemeType.${d.schemeType}`) : d.schemeType;
  const relationLabel = (r?: string) => (isDependantRelation(r) ? t(`relation.${r}`) : "—");

  return (
    <Card title={heading} padding>
      {d.decryptFailed && (
        <p role="alert" style={{ margin: "0 0 10px", color: "var(--bad)", fontSize: 13 }}>{t("decryptFailed")}</p>
      )}
      <div className="fields">
        <div className="fld">
          <span className="l">{t("fieldSchemeType")}</span>
          <span className="v">{schemeLabel}</span>
        </div>
        <div className="fld">
          <span className="l">{t("fieldCardNumber")}</span>
          <span className="v" data-testid="insurance-card-number">
            {d.cardNumber ?? "—"}
            {d.cardNumberMasked && !d.decryptFailed && (
              <span style={{ marginInlineStart: 8, color: "var(--mut)", fontSize: 12 }}>{t("maskedNote")}</span>
            )}
          </span>
        </div>
        {d.schemeId && (
          <div className="fld">
            <span className="l">{t("fieldSchemeId")}</span>
            <span className="v">{d.schemeId}</span>
          </div>
        )}
        <div className="fld">
          <span className="l">{t("fieldValidity")}</span>
          <span className="v">
            {t("validityRange", {
              from: formatIndianDate(d.validityFrom),
              to: d.validityTo ? formatIndianDate(d.validityTo) : t("openEnded"),
            })}
          </span>
        </div>
        {d.tier && (
          <div className="fld">
            <span className="l">{t("fieldTier")}</span>
            <span className="v">{d.tier}</span>
          </div>
        )}
        <div className="fld">
          <span className="l">{t("fieldAnnualLimit")}</span>
          <span className="v">{d.annualLimitMinor ? formatMoney(d.annualLimitMinor) : t("noLimit")}</span>
        </div>
        <div className="fld">
          <span className="l">{t("fieldDependants")}</span>
          <span className="v">
            {d.dependantsCount === 0 ? t("noDependants") : (
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {d.dependants.map((dep, i) => (
                  <li key={`${dep.relation ?? "x"}-${i}`}>
                    {dep.name
                      ? t("dependantRow", { name: dep.name, relation: relationLabel(dep.relation) })
                      : relationLabel(dep.relation)}
                    {dep.dateOfBirth ? ` · ${formatIndianDate(dep.dateOfBirth)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </span>
        </div>
      </div>
      {children}
    </Card>
  );
}
