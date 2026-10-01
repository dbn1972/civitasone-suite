import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState, Term } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getGpfStatements } from "../../../../_data/loaders";
import { MoneyChart } from "../_components/MoneyChart";
import { toResourceState } from "../../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";

type GpfRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  period: string;
  // GAP-PAYROLL-GPF-04: null = no contribution figure in the statement
  // (rendered "—" by DataTable's formatMoney); 0 = a real zero month.
  contrib: number | null;
} & Record<string, unknown>;

export default async function GpfStatementsPage() {
  const t = await getTranslations("gpfStatements");
  // GAP-PAYROLL-GPF-05: hr/layout.tsx admits employee/manager to every
  // /hr/payroll* route, and this ledger lists every employee's GPF
  // contributions. Gate on the same READER_ROLES payroll-service enforces on
  // GET /v1/payroll/statutory/gpf (statutory/routes.ts) BEFORE fetching.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return <PermissionDenied module="gpf" requiredRoles={PAYROLL_READER_ROLES} />;
  }

  const result = await getGpfStatements();
  const { data: rows } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const tableRows: GpfRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    // GAP-PAYROLL-GPF-02: was employeeId.slice(0, 8).toUpperCase() -- a UUID
    // prefix presented as a "code" and as the name fallback. Now the real HR
    // employee number payroll-service resolves from hrms (best-effort), or a
    // neutral "—" / "Unknown employee" -- never UUID-derived text.
    employeeCode: r.employeeCode ?? "—",
    employeeName: r.employeeName ?? t("unknownEmployee"),
    period: r.period,
    contrib: r.empContribMinor ?? null,
  }));

  const uniqueEmps = errored ? null : new Set(tableRows.map((r) => r.employeeId)).size;
  const uniquePeriods = errored ? null : new Set(tableRows.map((r) => r.period)).size;
  // GAP-PAYROLL-GPF-04: totals skip missing figures (they are not zeros);
  // how many rows had no figure is surfaced below instead of hidden.
  const totalContrib = tableRows.reduce((s, r) => s + (r.contrib ?? 0), 0);
  const missingCount = tableRows.filter((r) => r.contrib === null).length;

  // Period-wise trend
  const periodMap = new Map<string, number>();
  for (const r of tableRows) {
    periodMap.set(r.period, (periodMap.get(r.period) ?? 0) + (r.contrib ?? 0));
  }
  const sortedPeriods = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6);
  // GAP-PAYROLL-GPF-06: values stay in paise (no Math.round(value / 100),
  // which dropped paise and rendered bare "18330"); MoneyChart labels them
  // with formatMoney (₹ + lakh grouping).
  const trendChartData = sortedPeriods.map(([label, value]) => ({
    label: label.slice(2),
    value,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t.rich("title", { term: () => <Term name="GPF" /> })}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
        help="payroll"
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statStatements")} value={errored ? "—" : tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmployees")} value={uniqueEmps ?? "—"} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalContributions")} value={errored ? "—" : formatMoney(totalContrib)} />
        <StatCard icon="📅" iconBg="var(--panel)" label={t("statPeriods")} value={uniquePeriods ?? "—"} />
      </StatGrid>

      {/* GAP-PAYROLL-GPF-03: the "Accumulated Corpus" tile (a duplicate of
          the Total Contributions stat above, mislabelled as a corpus with no
          opening balance, interest or withdrawals) and the compounded
          "Projected Value at Retirement" tile (a tenant-wide contributions
          total projected 20 years at a single rate) are removed. A corpus
          belongs here only once the API returns real per-account balances. */}
      {!errored && missingCount > 0 && (
        <p role="note" className="pill warn" style={{ width: "fit-content", margin: "4px 0 12px" }}>
          {t("missingContribNote", { count: missingCount })}
        </p>
      )}

      {sortedPeriods.length > 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "18px 20px",
            marginTop: 4,
            maxWidth: 360,
          }}
        >
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

      {trendChartData.length > 1 && (
        <Card title={t("trendCardTitle")}>
          <MoneyChart type="line" data={trendChartData} height={180} />
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
          <DataTable<GpfRow>
            columns={[
              { key: "employeeName", label: t("colEmployee") },
              { key: "employeeCode", label: t("colCode") },
              { key: "period", label: t("colPeriod") },
              { key: "contrib", label: t("colContribution"), align: "right", cellType: "amount" },
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
