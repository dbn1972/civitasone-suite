/**
 * Retirement & Separation page — Sprint 14 / Lifecycle Phase 2
 * Top section: RetirementDashboard (card grid, next 6 months)
 * Middle: RetirementProcessWizard (interactive 5-step checklist)
 * Bottom: full register DataTable
 */
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployeeById } from "../../../_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { isUpcoming, SEPARATION_TYPES } from "@/lib/retirement";
import { humanizeStatus } from "@/lib/formatters";
import type { RetirementRow } from "./_components/RetirementDashboard";
import { RetirementCaseWorkspace } from "./_components/RetirementCaseWorkspace";
import { InitiateSeparationAction } from "./_components/InitiateSeparationAction";
import { getTranslations } from "next-intl/server";

// GAP-HR-RETIREMENT-06: retirement/separation is a DPDP-sensitive
// lifecycle event (separation types "death"/"termination" among them);
// the page previously had no role check of its own and relied on the
// generic RefreshErrorState fallback for a 403, which reads like an
// outage rather than a permission boundary. Matches the backend's own
// HR_ROLES (lifecycle/m7-list-routes.ts's GET /v1/hrms/retirements).
const RETIREMENT_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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
  const roles = getSessionRoles();
  if (!RETIREMENT_ROLES.some((r) => roles.includes(r))) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PermissionDenied module={t("title")} requiredRoles={RETIREMENT_ROLES} backHref="/hr" />
      </div>
    );
  }

  // HIGH fix: separation had no reachable "initiate" UI anywhere -- this
  // page already listed every separation but had no create action. ?empId=
  // arrives from the employee detail page's new "Initiate Separation" Quick
  // Action; resolved here (server-side, same loader the employee detail page
  // itself uses) so the form opens pre-filled with a real name instead of a
  // bare id.
  const prefillEmployeeId = searchParams?.empId;
  const prefillEmployee = prefillEmployeeId ? await getEmployeeById(prefillEmployeeId) : null;
  const prefillEmployeeName = prefillEmployee?.data?.name;
  const prefillEmployeeStatus = prefillEmployee?.data?.status;

  // GAP-HR-RETIREMENT-04: pre-compute a translated label server-side (this
  // is a server component, so next-intl's client useTranslations isn't
  // available here) instead of showing the raw lowercase enum in the
  // register.
  const tType = await getTranslations("initiateSeparation");
  function typeLabel(separationType: string | undefined): string {
    if (!separationType) return t("typeSuperannuation");
    const key = separationType.toLowerCase();
    return (SEPARATION_TYPES as readonly string[]).includes(key)
      ? tType(`separationType_${key}`)
      : humanizeStatus(separationType);
  }

  const COLUMNS: { key: keyof RetirementRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",           label: t("colEmployee") },
    { key: "department",         label: t("colDepartment") },
    { key: "designation",        label: t("colDesignation") },
    { key: "superannuationDate", label: t("colRetirementDate") },
    { key: "separationTypeLabel",label: t("colType") },
    { key: "status",             label: t("colStatus"), cellType: "status" },
  ];
  const { data: rawItems, source, status, errorMessage } = await getData();
  const errored = source === "error";
  const items = rawItems.map((i) => ({ ...i, separationTypeLabel: typeLabel(i.separationType) }));

  const upcoming = items.filter((i) => isUpcoming(i)).length;
  // GAP-HR-RETIREMENT-03: "Processed" counted status === "completed", which
  // nothing in this codebase ever sets (hrms_separations.status defaults to
  // "initiated" and no code path advances it -- confirmed by grep). Shown
  // as "Initiated" instead until a real status-transition workflow is
  // designed (needs a business owner, see the item's own decision note);
  // this is the item's own stated interim default, not a fabricated fix.
  const initiatedCount = items.filter((i) => i.status === "initiated").length;
  // GAP-HR-RETIREMENT-03: the zod enum is lowercase "vrs"
  // (lifecycle/validators.ts's separateBody) -- comparing against the
  // uppercase literal "VRS" made this stat permanently 0.
  const vrs = items.filter((i) => (i.separationType ?? "").toLowerCase() === "vrs").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<InitiateSeparationAction prefillEmployeeId={prefillEmployeeId} prefillEmployeeName={prefillEmployeeName} prefillEmployeeStatus={prefillEmployeeStatus} />}
      />
      <DataSourceBadge source={source} message="Couldn't load retirement records — showing nothing" />

      {/* KPI strip */}
      <StatGrid>
        <StatCard icon="👴" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")}     value={errored ? null : items.length} />
        <StatCard icon="📅" iconBg="var(--warnbg, #fffbe6)" label={t("statUpcoming")} value={errored ? null : upcoming} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statInitiated")} value={errored ? null : initiatedCount} />
        <StatCard icon="📝" iconBg="var(--bg, #f5f5f5)" label={t("statVrs")}          value={errored ? null : vrs} />
      </StatGrid>

      {/* Card grid + wizard, bound to the same selected retiree */}
      {!errored && <RetirementCaseWorkspace rows={items} />}

      {/* Full register */}
      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitle")}>
          {errored ? (
            <div className="pad">
              {/* GAP-HR-RETIREMENT-06: LoadErrorState (403-aware) rather
                  than RefreshErrorState so a permission failure reads as
                  one, though the role gate above should now make that path
                  unreachable via the UI -- kept as defense in depth in case
                  the backend HR_ROLES list and this page's ever drift. */}
              <LoadErrorState result={{ status, errorMessage }} area="retirement" backHref="/hr" />
            </div>
          ) : (
            <DataTable<RetirementRow & { separationTypeLabel: string }>
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
