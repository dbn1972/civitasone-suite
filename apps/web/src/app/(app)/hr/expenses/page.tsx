import { HR_EXPENSE_DECIDE_ROLES } from "@/lib/auth/workRoles";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { mapExpenses, type ApiExpense, type Row } from "./mapExpenses";
import { NewExpenseClaimForm } from "./NewExpenseClaimForm";
import { parseTravelRequestId } from "./travelLink";
import { ExpensesView } from "./ExpensesView";

// (services/hrms-service/src/modules/social/routes.ts) -- same convention as
// hr/advances' ADVANCE_DECIDE_ROLES. This only controls whether the
// Approvals tab and its row actions render; the server is the real gate on
// every PATCH .../approve, .../reject, and GET ?scope=approvals call.

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/expenses", [], {
    telemetryKey: "hr.expenses",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiExpense[] })?.data;
      return Array.isArray(arr) ? mapExpenses(arr as ApiExpense[]) : null;
    },
  });
  return r;
}

async function getApprovalsData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/expenses?scope=approvals", [], {
    telemetryKey: "hr.expenses.approvals",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiExpense[] })?.data;
      return Array.isArray(arr) ? mapExpenses(arr as ApiExpense[]) : null;
    },
  });
  return r;
}

export default async function ExpensesPage({ searchParams }: { searchParams?: { travelRequestId?: string | string[] } }) {
  // GAP-HR-TRAVEL-02: an approved travel request links here to pre-link the claim.
  const travelRequestId = parseTravelRequestId(searchParams?.travelRequestId);
  const t = await getTranslations("expenses");
  const roles = getSessionRoles();
  const canDecide = roles.some((r) => HR_EXPENSE_DECIDE_ROLES.includes(r));

  const { data: items, source } = await getData();
  const errored = source === "error";
  // GAP-HR-EXPENSES-02: only fetched for a session that can actually act on
  // it -- a plain employee never issues this request (the backend would
  // 403 it anyway, but there is no reason to even ask).
  const approvalItems = canDecide ? (await getApprovalsData()).data : [];

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statTotalClaimsLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>

      <NewExpenseClaimForm {...(travelRequestId ? { travelRequestId } : {})} />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "expenses" })} backHref="/hr" />
          </div>
        ) : (
          <ExpensesView myRows={items} approvalRows={approvalItems} canDecide={canDecide} />
        )}
      </Card>
    </div>
  );
}
