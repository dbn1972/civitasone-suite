import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { EmployeeFyLookup } from "./EmployeeFyLookup";
import { PerquisiteComponentForm } from "./PerquisiteComponentForm";

type PerquisiteLine = {
  sl: number;
  nature: string;
  description?: string;
  taxableValueMinor: number;
  value: number;
};

type Form12BAResponse = {
  formType: string;
  fy: string;
  assessmentYear: string;
  employer: { name: string; tan: string; pan: string };
  employee: { employeeId: string; pan: string; name: string; panFlag: string };
  perquisites: PerquisiteLine[];
  totalPerquisitesMinor: number;
  totalPerquisites: number;
  note: string;
};

async function getForm12BA(employeeId: string, fy: string): Promise<LoaderResult<Form12BAResponse | null>> {
  return fetchJson<Form12BAResponse, Form12BAResponse | null>(
    `/api/v1/payroll/statutory/form12ba?employeeId=${encodeURIComponent(employeeId)}&fy=${encodeURIComponent(fy)}`,
    null,
    {
      telemetryKey: "payroll.statutory.form12ba",
      mapResponse: (p) => (p && Array.isArray(p.perquisites) ? p : null),
    },
  );
}

export default async function PerquisitePage({ searchParams }: { searchParams?: { employeeId?: string; fy?: string } }) {
  const t = await getTranslations("perquisite");
  const employeeId = searchParams?.employeeId?.trim();
  const fy = searchParams?.fy?.trim();
  const canLookup = !!employeeId && !!fy;

  const result = canLookup ? await getForm12BA(employeeId!, fy!) : null;
  const source = result?.source ?? "api";
  const form12ba = result?.data ?? null;
  const perqCount = form12ba?.perquisites?.length ?? 0;
  const totalPerqMinor = form12ba?.totalPerquisitesMinor ?? 0;
  const maxPerqMinor = form12ba && form12ba.perquisites.length > 0
    ? Math.max(...form12ba.perquisites.map((p) => p.taxableValueMinor))
    : 0;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel="Back to Statutory"
      />
      {canLookup && <DataSourceBadge source={source === "error" ? "error" : "api"} message={t("loadErrorMessage")} />}

      {canLookup && form12ba && (
        <StatGrid>
          <StatCard icon="📋" iconBg="var(--infobg)" label={t("statPerquisiteItems")} value={perqCount} />
          <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalTaxableValue")} value={formatMoney(totalPerqMinor)} />
          <StatCard icon="📈" iconBg="var(--warnbg)" label={t("statLargestPerquisite")} value={formatMoney(maxPerqMinor)} />
          <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statFinancialYear")} value={form12ba.fy} />
        </StatGrid>
      )}

      <EmployeeFyLookup employeeId={employeeId ?? ""} fy={fy ?? ""} />

      <PerquisiteComponentForm defaultEmployeeId={employeeId ?? ""} defaultFy={fy ?? ""} />

      <Card title={t("form12baCardTitle")}>
        {!canLookup ? (
          <EmptyState
            icon="📄"
            title={t("selectEmployeeFyTitle")}
            message={t("selectEmployeeFyMessage")}
          />
        ) : !form12ba ? (
          <EmptyState
            icon="📄"
            title={t("noForm12baTitle")}
            message={t("noForm12baMessage", { fy: fy ?? "" })}
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employeeLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employee.name || form12ba.employee.employeeId}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("panLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employee.pan || form12ba.employee.panFlag}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("totalPerquisitesLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{formatMoney(form12ba.totalPerquisitesMinor)}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>{t("colSl")}</th>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>{t("colNature")}</th>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>{t("colDescription")}</th>
                  <th scope="col" style={{ textAlign: "right", padding: "6px 8px", fontSize: 13 }}>{t("colTaxableValue")}</th>
                </tr>
              </thead>
              <tbody>
                {form12ba.perquisites.map((p) => (
                  <tr key={p.sl}>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.sl}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.nature}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.description || "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>{formatMoney(p.taxableValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--ink2)" }}>{form12ba.note}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
