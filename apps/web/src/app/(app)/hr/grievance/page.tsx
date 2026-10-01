import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's own
 * HR_ROLES on GET /v1/hrms/grievances exactly (requireRole(ctx, HR_ROLES),
 * HR_ROLES = ["hr_admin", "super_admin", "hr_officer"]).
 */
const GRIEVANCE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type RawRow = {
  id: string;
  employee: string;
  department: string;
  category: string;
  filedDate: string;
  assignedTo: string;
  description: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

// GAP-HR-GRIEVANCE-01: GET /v1/hrms/grievances is a permanent stub today
// (gap-features/routes.ts:718-722) -- it always returns
// `{ data: [], meta: { note: "Grievance table pending..." } }`. The old
// mapResponse discarded `meta` entirely, so this looked identical to "zero
// real grievances on file" (a normal, good outcome) instead of "this
// register was never built" -- an officer had no way to tell the two apart.
// Whether to actually build the register (a real hrms_grievances table +
// GET/POST/PATCH) is this ticket's own formal_decision, and the published
// decision packet explicitly leaves it to a product call ("Needs your
// call": build now or park?) with no stated default for that half -- so
// this only ships the packet's *other*, unconditional half ("Ships either
// way: replace the misleading zeros with an honest 'not yet available'
// state"), carried through as `notBuilt` here instead of collapsing straight
// to an empty array.
type GrievanceListResult = { items: RawRow[]; notBuilt: boolean };

async function getData(): Promise<LoaderResult<GrievanceListResult>> {
  return fetchJson<unknown, GrievanceListResult>(
    "/api/v1/hrms/grievances",
    { items: [], notBuilt: false },
    {
      telemetryKey: "hr.grievances",
      mapResponse: (p) => {
        const body = p as { data?: RawRow[]; meta?: { note?: string } } | null;
        if (!body || !Array.isArray(body.data)) return null;
        return { items: body.data, notBuilt: !!body.meta?.note };
      },
    },
  );
}

const INQUIRY_STATUSES: ReadonlySet<string> = new Set(["under_inquiry", "in_progress"]);
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["closed", "disposed", "dropped"]);

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export default async function GrievancePage() {
  const t = await getTranslations("grievance");

  // GAP-HR-GRIEVANCE-04/05: this page had no role gate of its own at all
  // (relied entirely on the API's own 403) even though hr/layout.tsx admits
  // "manager" and "employee" into /hr -- an unauthorized viewer got the
  // generic retryable "couldn't load" error instead of an honest
  // PermissionDenied, and (once real data exists behind GRIEVANCE-01) would
  // have made a doomed fetch for a register whose rows include employee
  // name/department/category -- fields DPDP-sensitive enough (category can
  // reveal health, caste, or harassment context) to gate client-side too,
  // defense-in-depth alongside the server's own check, same pattern
  // hr/disciplinary/page.tsx already uses.
  const roles = getSessionRoles();
  const canAccess = roles.some((r: string) => GRIEVANCE_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="grievances" requiredRoles={GRIEVANCE_ROLES} />;
  }

  const result = await getData();
  const { data, source } = result;
  const errored = source === "error";
  const notBuilt = !errored && data.notBuilt;
  const items: Row[] = data.items.map((r) => ({ ...r, caseRef: shortId(r.id) }));

  // GAP-HR-GRIEVANCE-06: there is no grievance status enum yet (the register
  // is a stub, GAP-HR-GRIEVANCE-01), so the explicit sets below are the two
  // "known" stages; everything else -- including any status not listed, e.g.
  // 'escalated' -- counts as Open. That keeps Open + Under Inquiry + Disposed
  // equal to Total instead of silently dropping unlisted statuses.
  const inquiry = items.filter((i) => INQUIRY_STATUSES.has(i.status)).length;
  const closed = items.filter((i) => TERMINAL_STATUSES.has(i.status)).length;
  const opened = items.length - inquiry - closed;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colRefNo") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "category", label: t("colGrievance") },
    { key: "filedDate", label: t("colFiledDate") },
    { key: "assignedTo", label: t("colHrOfficer") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // GAP-HR-GRIEVANCE-01: stat cards show a dash (not a real "0") whenever
  // the register is a stub or the fetch itself failed -- `0` is a claim
  // about real data ("we checked, there are none"); neither of those two
  // states is that.
  const statValue = (n: number) => (errored || notBuilt ? null : n);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCasesLabel")} value={statValue(items.length)} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statOpenLabel")} value={statValue(opened)} />
        <StatCard icon="🔍" iconBg="var(--warnbg, #fffbe6)" label={t("statUnderInquiryLabel")} value={statValue(inquiry)} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedLabel")} value={statValue(closed)} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="grievances" backHref="/hr" requiredRoles={GRIEVANCE_ROLES} />
          </div>
        ) : notBuilt ? (
          <div className="pad">
            <EmptyState
              icon="🏗️"
              title={t("notBuiltTitle")}
              message={t("notBuiltMessage")}
            />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📋"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
