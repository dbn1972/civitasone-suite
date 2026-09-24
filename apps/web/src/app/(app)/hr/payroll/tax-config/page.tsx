import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}

export default async function TaxConfigPage() {
  try {
    const t = await getTranslations("payrollTaxConfig");
    const fy = getCurrentFY();
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />

        <div className="grid g-2">
          <Card title={t("cardNewRegime")} padding>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("thSlabAnnual")}</th><th>{t("thRate")}</th></tr></thead>
              <tbody>
                <tr><td>{t("newUpTo3L")}</td><td>{t("nil")}</td></tr>
                <tr><td>₹3,00,001 – ₹7,00,000</td><td>5%</td></tr>
                <tr><td>₹7,00,001 – ₹10,00,000</td><td>10%</td></tr>
                <tr><td>₹10,00,001 – ₹12,00,000</td><td>15%</td></tr>
                <tr><td>₹12,00,001 – ₹15,00,000</td><td>20%</td></tr>
                <tr><td>{t("newAbove15L")}</td><td>30%</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("newRegimeNote")}</p>
          </Card>

          <Card title={t("cardOldRegime")} padding>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("thSlabAnnual")}</th><th>{t("thRate")}</th></tr></thead>
              <tbody>
                <tr><td>{t("oldUpTo2_5L")}</td><td>{t("nil")}</td></tr>
                <tr><td>₹2,50,001 – ₹5,00,000</td><td>5%</td></tr>
                <tr><td>₹5,00,001 – ₹10,00,000</td><td>20%</td></tr>
                <tr><td>{t("oldAbove10L")}</td><td>30%</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("oldRegimeNote")}</p>
          </Card>

          <Card title={t("cardDeductionLimits")} padding>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("thSection")}</th><th>{t("thLimit")}</th><th>{t("thDescription")}</th></tr></thead>
              <tbody>
                <tr><td>80C</td><td>₹1,50,000</td><td>{t("desc80C")}</td></tr>
                <tr><td>80D</td><td>{t("limit80D")}</td><td>{t("desc80D")}</td></tr>
                <tr><td>{t("section80CCD1B")}</td><td>₹50,000</td><td>{t("desc80CCD1B")}</td></tr>
                <tr><td>80TTA</td><td>₹10,000</td><td>{t("desc80TTA")}</td></tr>
                <tr><td>{t("sectionSec24")}</td><td>₹2,00,000</td><td>{t("descSec24")}</td></tr>
                <tr><td>HRA</td><td>{t("hraLimitLabel")}</td><td>{t("hraDescription")}</td></tr>
              </tbody>
            </table>
          </Card>

          <Card title={t("cardSurchargeCess")} padding>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("thIncome")}</th><th>{t("thSurcharge")}</th></tr></thead>
              <tbody>
                <tr><td>{t("surcharge50LTo1Cr")}</td><td>10%</td></tr>
                <tr><td>{t("surcharge1CrTo2Cr")}</td><td>15%</td></tr>
                <tr><td>{t("aboveTwoCr")}</td><td>25%</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("cessNote")}</p>
          </Card>
        </div>

        <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
          {t("footerNote", { fy })}
        </p>
      </div>
    );
  } catch {
    return (
      <div className="page-main wrap">
        <RefreshErrorState error={toHumanError("load", { area: "tax configuration" })} backHref="/hr/payroll" />
      </div>
    );
  }
}
