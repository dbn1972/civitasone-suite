import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { LoansTable } from "./LoansTable";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";

// GAP-HR-LOANS-04: mirrors the backend's ALL_ROLES exactly (services/
// hrms-service/src/modules/employee/loans-routes.ts) -- this page had no
// role gate at all, so a plain "employee" (admitted by hr/layout.tsx but
// not by this route) hit a bare 403 rendered as a generic retryable error
// instead of an honest "Access restricted".
const LOANS_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer", "manager", "officer"];
// GAP-HR-LOANS-02: CSV export dumps sanctioned amounts, EMI, balance and
// employee identity with no role check today -- restrict the export button
// to HR/finance roles, matching the decision packet's platform-wide default
// for HR exports (GAP-HR-LOANS-02 / TRANSFER-05: "gate exports to HR roles
// only... proceeding as a general rule unless you object"). The audit-event
// half of that same default is NOT done here: it needs a POST target in
// audit-service whose existence this campaign's catalog itself could not
// verify ("not verified in this snapshot") -- inventing an endpoint would be
// worse than leaving it flagged. See this PR's description.
const LOANS_EXPORT_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer"];

const LOAN_TYPES = ["hba", "motor_car", "computer", "festival", "personal", "medical", "other"] as const;

type ApiLoan = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  loanType: string;
  sanctionedAmountMinor: number;
  emiMinor: number;
  outstandingMinor: number;
  totalEmis: number;
  emisPaid: number;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  loanType: string;
  sanctionedAmount: number | null;
  emi: number | null;
  balance: number | null;
  emiProgress: string;
  status: string;
} & Record<string, unknown>;

function mapLoans(apiLoans: ApiLoan[], loanTypeLabel: (code: string) => string): Row[] {
  return apiLoans.map((l) => ({
    id: l.id,
    // GAP-HR-LOANS-01: employeeName/department are now resolved server-side
    // (loans-routes.ts, via the shared batchEmployees/batchDepartments
    // helper) -- "Unknown employee" (not the raw UUID) when genuinely absent,
    // per this item's own acceptance text.
    employee: l.employeeName ?? "Unknown employee",
    department: l.department ?? "—",
    loanType: loanTypeLabel(l.loanType),
    sanctionedAmount: l.sanctionedAmountMinor ?? null,
    emi: l.emiMinor != null ? l.emiMinor : null,
    balance: l.outstandingMinor != null ? l.outstandingMinor : null,
    // GAP-HR-LOANS-03: emisPaid/totalEmis were fetched by the API all along
    // but never shown -- a plain "x / y" string needs no client-side
    // render() (DataTable's default cell rendering is String(value), which
    // is server-safe), so no ProgressBar visual is added here, only the text.
    emiProgress: l.totalEmis > 0 ? `${l.emisPaid} / ${l.totalEmis}` : "—",
    status: l.status,
  }));
}

export default async function LoansPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => LOANS_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="loans" requiredRoles={LOANS_ROLES} />;
  }
  const canExport = roles.some((r) => LOANS_EXPORT_ROLES.includes(r));

  const t = await getTranslations("loans");
  // GAP-HR-LOANS-05: raw backend codes (hba, motor_car, ...) were shown
  // verbatim; map the known set to translated labels and fall back to the
  // raw code for anything unrecognized rather than risk a missing-key throw.
  const typeLabels: Record<string, string> = Object.fromEntries(
    LOAN_TYPES.map((code) => [code, t(`types.${code}`)]),
  );
  const loanTypeLabel = (code: string) => typeLabels[code] ?? code;

  const rawResult = await fetchJson<unknown, ApiLoan[]>("/api/v1/hrms/loans", [], {
    telemetryKey: "hr.loans",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiLoan[] })?.data;
      return Array.isArray(arr) ? (arr as ApiLoan[]) : null;
    },
  });
  const items: Row[] = rawResult.data ? mapLoans(rawResult.data, loanTypeLabel) : [];
  const source = rawResult.source;
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "closed").length;
  // GAP-HR-LOANS-06: any status besides active/pending/completed/closed
  // (e.g. rejected, foreclosed) previously counted in Total but in no tile.
  const other = items.length - active - pending - completed;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "loanType", label: t("colLoanType") },
    { key: "sanctionedAmount", label: t("colSanctioned"), cellType: "amount" },
    { key: "emi", label: t("colEmi"), cellType: "amount" },
    { key: "balance", label: t("colBalance"), cellType: "amount" },
    { key: "emiProgress", label: t("colEmiProgress") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backToHr")} />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLoansLabel")} value={errored ? null : items.length} />
        <StatCard icon="▶️" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? null : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--bg, #f5f5f5)" label={t("statClosedLabel")} value={errored ? null : completed} />
        {!errored && other > 0 && (
          <StatCard icon="❔" iconBg="var(--bg, #f5f5f5)" label={t("statOtherLabel")} value={other} />
        )}
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={rawResult} area="loans" backHref="/hr" requiredRoles={LOANS_ROLES} />
          </div>
        ) : (
          <LoansTable<Row> columns={columns} rows={items} sortable filterable exportable={canExport}
          filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="💳"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
            emptyAction={<Link href="/hr/payroll/loans" className="btn">{t("emptyActionLink")}</Link>}
          />
        )}
      </Card>
    </div>
  );
}
