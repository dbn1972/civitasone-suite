import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState, maskLast4 } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getNpsStatements } from "../../../../_data/loaders";
import { MoneyChart } from "../_components/MoneyChart";
import { toResourceState } from "../../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { reconciliationKey, countNeedingAttention } from "../_components/reconciliation";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  pran: string;
  period: string;
  // GAP-PAYROLL-NPS-03: null = no figure in the statement (DataTable's
  // formatMoney renders "—"); 0 = a real zero contribution.
  emp: number | null;
  er: number | null;
  reconciliation: string;
} & Record<string, unknown>;

export default async function NpsStatementsPage() {
  const t = await getTranslations("npsStatements");
  // GAP-PAYROLL-NPS-05: hr/layout.tsx admits employee/manager to every
  // /hr/payroll* route, and this ledger lists every subscriber's
  // contributions. Gate on payroll-service's own READER_ROLES for GET
  // /v1/payroll/statutory/nps (statutory/routes.ts), before any fetch.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return <PermissionDenied module="nps" requiredRoles={PAYROLL_READER_ROLES} />;
  }

  const result = await getNpsStatements();
  const { data: rows } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const tableRows: NpsRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    // GAP-PAYROLL-NPS-02: was employeeId.slice(0, 8).toUpperCase() -- a
    // fabricated UUID prefix shown as "Code" and as the name fallback. Now
    // the real HR employee number and a masked PRAN (payroll-service only
    // ever receives the last 4 PRAN characters from hrms).
    employeeCode: r.employeeCode ?? "—",
    employeeName: r.employeeName ?? t("unknownEmployee"),
    pran: r.pranLast4 ? maskLast4(r.pranLast4) : "—",
    period: r.period,
    reconciliation: t(reconciliationKey(r.reconciliation)),
    emp: r.empContribMinor ?? null,
    er: r.erContribMinor ?? null,
  }));

  const attentionCount = errored ? 0 : countNeedingAttention(rows);
  const uniqueEmps = errored ? null : new Set(tableRows.map((r) => r.employeeId)).size;
  // Totals skip missing figures (GAP-PAYROLL-NPS-03) -- unchanged for
  // complete data; rows with a missing figure are counted and surfaced.
  const totalEmp = tableRows.reduce((s, r) => s + (r.emp ?? 0), 0);
  const totalEr = tableRows.reduce((s, r) => s + (r.er ?? 0), 0);
  // GAP-PAYROLL-NPS-04: this is a contributions total, not a corpus (no
  // NAV/returns), and is labelled as such.
  const totalContributions = totalEmp + totalEr;
  const missingCount = tableRows.filter((r) => r.emp === null || r.er === null).length;

  // Period-wise trend data (last 6 periods)
  const periodMap = new Map<string, number>();
  for (const r of tableRows) {
    periodMap.set(r.period, (periodMap.get(r.period) ?? 0) + (r.emp ?? 0) + (r.er ?? 0));
  }
  const sortedPeriods = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6);
  // GAP-PAYROLL-NPS-06: paise values, labelled by MoneyChart's formatMoney.
  const trendChartData = sortedPeriods.map(([label, value]) => ({
    label: label.slice(2), // "2026-06" → "26-06"
    value,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statStatements")} value={errored ? "—" : tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmployees")} value={uniqueEmps ?? "—"} />
        <StatCard icon="🧑" iconBg="var(--warnbg)" label={t("statTotalEmployee")} value={errored ? "—" : formatMoney(totalEmp)} />
        <StatCard icon="🏛️" iconBg="var(--panel)" label={t("statTotalEmployer")} value={errored ? "—" : formatMoney(totalEr)} />
      </StatGrid>

      {!errored && attentionCount > 0 && (
        <p role="note" className="pill warn" style={{ width: "fit-content", margin: "4px 0 12px" }}>
          {t("reconcileAttentionNote", { count: attentionCount })}
        </p>
      )}

      {!errored && missingCount > 0 && (
        <p role="note" className="pill warn" style={{ width: "fit-content", margin: "4px 0 12px" }}>
          {t("missingContribNote", { count: missingCount })}
        </p>
      )}

      {/* GAP-PAYROLL-NPS-04: the old "Projected Corpus at Retirement" tile
          (the tenant-wide contributions total compounded 25 years at an
          assumed 9.5%) is removed -- a corpus is shown only from a real
          balance source (per-subscriber balances live on hrms-service's
          GET /v1/hrms/employees/:id/nps). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 4,
        }}
      >
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px" }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--mut)", textTransform: "uppercase" }}>
            {t("totalContributionsLabel")}
          </p>
          <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "var(--ink)" }}>
            {errored ? "—" : formatMoney(totalContributions)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
            {t("accumulatedCorpusNote")}
          </p>
        </div>

        {sortedPeriods.length > 0 && (
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--mut)", textTransform: "uppercase" }}>
              {t("lastPeriodLabel")}
            </p>
            <p style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>
              {formatMoney(sortedPeriods[sortedPeriods.length - 1][1])}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
              {t("periodValue", { period: sortedPeriods[sortedPeriods.length - 1][0] })}
            </p>
          </div>
        )}
      </div>

      {trendChartData.length > 1 && (
        <Card title={t("trendCardTitle")}>
          <MoneyChart type="bar" data={trendChartData} height={180} />
        </Card>
      )}

      <Card title={t("ledgerCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll" />
          </div>
        ) : tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<NpsRow>
            columns={[
              { key: "employeeName", label: t("colEmployee") },
              { key: "employeeCode", label: t("colCode") },
              { key: "pran", label: t("colPran") },
              { key: "period", label: t("colPeriod") },
              { key: "emp", label: t("colEmployeeContrib"), align: "right", cellType: "amount" },
              { key: "er", label: t("colEmployerContrib"), align: "right", cellType: "amount" },
              { key: "reconciliation", label: t("colReconciliation") },
            ]}
            rows={tableRows}
            rowLinkKey="employeeId"
            rowLinkPrefix="/hr/employees/"
            identifyingColumnKey="employeeName"
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={20}
            emptyIcon="🏦"
            emptyTitle={t("emptyTitleFiltered")}
            emptyMessage={t("emptyMessageFiltered")}
          />
        )}
      </Card>
    </div>
  );
}
