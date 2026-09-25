/**
 * Retirement & Separation page — Sprint 14 / Lifecycle Phase 2
 * Top section: RetirementDashboard (card grid, next 6 months)
 * Middle: RetirementProcessWizard (interactive 5-step checklist)
 * Bottom: full register DataTable
 */
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployeeById } from "../../../_data/loaders";
import type { RetirementRow } from "./_components/RetirementDashboard";
import { RetirementCaseWorkspace } from "./_components/RetirementCaseWorkspace";
import { InitiateSeparationAction } from "./_components/InitiateSeparationAction";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

async function getData(): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>("/api/v1/hrms/retirements", [], {
    telemetryKey: "hr.retirement",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RetirementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function RetirementPage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  const t = await getTranslations("retirement");
  // HIGH fix: separation had no reachable "initiate" UI anywhere -- this
  // page already listed every separation but had no create action. ?empId=
  // arrives from the employee detail page's new "Initiate Separation" Quick
  // Action; resolved here (server-side, same loader the employee detail page
  // itself uses) so the form opens pre-filled with a real name instead of a
  // bare id. Unlike this page's sibling Transfer/Promotion Quick Actions,
  // which also pass ?empId= but never actually consume it (checked: neither
  // transfer/page.tsx nor TransferWithApproval.tsx reads searchParams at
  // all -- a pre-existing gap, not fixed here since it's outside this
  // change's scope), this one genuinely prefills.
  const prefillEmployeeId = searchParams?.empId;
  const prefillEmployee = prefillEmployeeId ? await getEmployeeById(prefillEmployeeId) : null;
  const prefillEmployeeName = prefillEmployee?.data?.name;
  const COLUMNS: { key: keyof RetirementRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",          label: t("colEmployee") },
    { key: "department",        label: t("colDepartment") },
    { key: "designation",       label: t("colDesignation") },
    { key: "superannuationDate",label: t("colRetirementDate") },
    { key: "separationType",    label: t("colType") },
    { key: "status",            label: t("colStatus"), cellType: "status" },
  ];
  const { data: items, source } = await getData();
  const errored = source === "error";

  const cutoff6m  = new Date();
  cutoff6m.setMonth(cutoff6m.getMonth() + 6);
  const upcoming  = items.filter((i) => {
    if (!i.superannuationDate) return false;
    const d = new Date(i.superannuationDate);
    return d >= new Date() && d <= cutoff6m;
  }).length;
  const completed = items.filter((i) => i.status === "completed").length;
  const vrs       = items.filter((i) => i.separationType === "VRS").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<InitiateSeparationAction prefillEmployeeId={prefillEmployeeId} prefillEmployeeName={prefillEmployeeName} />}
      />
      <DataSourceBadge source={source} message="Couldn't load retirement records — showing nothing" />

      {/* KPI strip */}
      <StatGrid>
<StatCard icon="👴" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")}          value={errored ? null : items.length} />
        <StatCard icon="📅" iconBg="var(--warnbg, #fffbe6)" label={t("statUpcoming")}  value={errored ? null : upcoming} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statProcessed")}       value={errored ? null : completed} />
        <StatCard icon="📝" iconBg="var(--bg, #f5f5f5)" label={t("statVrs")}            value={errored ? null : vrs} />
      </StatGrid>

      {/* Card grid + wizard, bound to the same selected retiree */}
      {!errored && <RetirementCaseWorkspace rows={items} />}

      {/* Full register */}
      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitle")}>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "retirement" })} backHref="/hr" />
            </div>
          ) : (
            <DataTable<RetirementRow>
              columns={COLUMNS}
              rows={items}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="🎓"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
