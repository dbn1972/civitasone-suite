import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CtcCalculatorForm } from "./CtcCalculatorForm";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_REPORT_ROLES } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

/**
 * One payroll.payroll_ctc_config row (GET /v1/payroll/ctc/config). The API
 * only ever returns ACTIVE rows (repo.listCtcConfig filters is_active=true).
 * `value` is NUMERIC(10,4) whose unit depends on calc_type:
 *   pct_of_basic / pct_of_ctc -> a percentage (40.0000 = 40%)
 *   fixed                     -> PAISE (POST /ctc/calculate uses it directly
 *                                as amountMinor)
 *   formula                   -> a rule/coefficient, never money
 */
type ConfigRow = {
  id: string;
  component_code: string;
  component_name: string;
  calc_type: string;
  value: string | number;
  is_employer_cost: boolean;
  is_active: boolean;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<ConfigRow[]>> {
  return fetchJson<unknown, ConfigRow[]>("/api/v1/payroll/ctc/config", [], {
    telemetryKey: "payroll.ctc.config",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ConfigRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CtcConfigPage() {
  const t = await getTranslations("payrollCtc");
  // GAP-PAYROLL-COMPARISON-03 (applied to the sibling CTC page, as its fix
  // steps ask): payroll-service's /ctc endpoints admit only these roles.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_REPORT_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="CTC configuration" requiredRoles={PAYROLL_REPORT_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const CALC_TYPE_LABEL: Record<string, string> = {
    pct_of_basic: t("calcTypePctOfBasic"),
    pct_of_ctc: t("calcTypePctOfCtc"),
    fixed: t("calcTypeFixed"),
    formula: t("calcTypeFormula"),
  };
  const { data: config, source } = await getData();
  const errored = source === "error";

  const rows = config.map((c) => {
    const isPct = c.calc_type === "pct_of_basic" || c.calc_type === "pct_of_ctc";
    const numeric = Number(c.value);
    // GAP-PAYROLL-CTC-03: only "fixed" values are money (paise); a "formula"
    // value is a rule/coefficient and is never shown with a ₹ sign.
    const valueDisplay = isPct
      ? Number.isFinite(numeric) ? `${numeric}%` : String(c.value)
      : c.calc_type === "fixed"
        ? formatMoney(c.value as number | string)
        : c.calc_type === "formula"
          ? t("formulaValue", { value: Number.isFinite(numeric) ? String(numeric) : String(c.value) })
          : String(c.value);
    return {
      ...c,
      calcTypeLabel: CALC_TYPE_LABEL[c.calc_type] ?? c.calc_type,
      valueDisplay,
      employerCostLabel: c.is_employer_cost ? t("yes") : t("no"),
    };
  });

  type Row = (typeof rows)[number];

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right" }[] = [
    { key: "component_code", label: t("colCode") },
    { key: "component_name", label: t("colComponent") },
    { key: "calcTypeLabel", label: t("colCalculation") },
    { key: "valueDisplay", label: t("colValue"), align: "right" },
    { key: "employerCostLabel", label: t("colEmployerCost") },
  ];

  const employerComponents = config.filter((c) => c.is_employer_cost).length;
  // GAP-PAYROLL-CTC-01: the API returns active rows only, so an "Active
  // Components" KPI always equalled the total and could not be reconciled
  // with the table. Show the fixed-amount count instead.
  const fixedComponents = config.filter((c) => c.calc_type === "fixed").length;
  const pctComponents = config.filter((c) => c.calc_type.startsWith("pct_")).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />
      <StatGrid>
        <StatCard icon="⚙️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : config.length} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label={t("statEmployerCost")} value={errored ? null : employerComponents} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statFixed")} value={errored ? null : fixedComponents} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statPctBased")} value={errored ? null : pctComponents} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "ctc" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚙️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>

      <CtcCalculatorForm />
    </div>
  );
}
