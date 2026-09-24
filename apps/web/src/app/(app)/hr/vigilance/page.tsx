import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's
 * HR_ROLES guard on GET /v1/hrms/vigilance exactly.
 */
const VIGILANCE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type RawRow = {
  id: string;
  employee: string;
  department: string;
  charges: string;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/vigilance", [], {
    telemetryKey: "hr.vigilance",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

function shortId(id: string): string {
  return "VIG/" + id.slice(0, 8).toUpperCase();
}

export default async function VigilancePage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => VIGILANCE_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="vigilance cases" requiredRoles={VIGILANCE_ROLES} />;
  }

  const t = await getTranslations("vigilance");
  const { data: rawItems, source } = await getData();
  const errored = source === "error";
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: shortId(r.id) }));

  // Real status enum (disciplinary/state-machine.ts's CaseStatus, shared by
  // this table since a vigilance case is simply a proceeding_type='major'
  // disciplinary case -- see gap-features/routes.ts's GET /v1/hrms/vigilance):
  // opened, charge_memo_issued, inquiry_appointed, finding_recorded,
  // pending_approval, penalty_imposed, appeal_filed, appeal_decided, closed,
  // dropped -- 10 statuses total. "inquiry"/"under_inquiry" and
  // "disposed"/"finalised" below were never real statuses for this table, so
  // "Under Inquiry" could never show a nonzero count and 7 of the 10 real
  // statuses (charge_memo_issued, inquiry_appointed, finding_recorded,
  // pending_approval, penalty_imposed, appeal_filed, dropped) silently
  // vanished from every stat card. Buckets below are mutually exclusive and
  // jointly exhaustive over all 10 (2 + 6 + 2 = every case, exactly once),
  // preserving each existing card's original intent/label rather than
  // introducing new ones.
  const chargeMemoStage = items.filter((i) => ["opened", "charge_memo_issued"].includes(i.status)).length;
  const underInquiry = items.filter((i) => [
    "inquiry_appointed", "finding_recorded", "pending_approval",
    "penalty_imposed", "appeal_filed", "appeal_decided",
  ].includes(i.status)).length;
  const closed = items.filter((i) => ["closed", "dropped"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "charges", label: t("colChargeSummary") },
    { key: "inquiryOfficer", label: t("colInquiryOfficer") },
    // Backend aliases inquiry_appointed_date (a one-time event) as
    // "nextHearing" -- it is not a recurring hearing schedule, so a case
    // shows the same date forever after its inquiry officer is appointed,
    // regardless of how many hearings actually happen afterward. Labelled
    // honestly until the backend tracks real hearing dates.
    { key: "nextHearing", label: t("colInquiryOfficerAppointed") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

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
        <StatCard icon="⚖️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCasesLabel")} value={errored ? null : items.length} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statChargeMemoStageLabel")} value={errored ? null : chargeMemoStage} />
        <StatCard icon="🔍" iconBg="var(--warnbg, #fffbe6)" label={t("statUnderInquiryLabel")} value={errored ? null : underInquiry} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedClosedLabel")} value={errored ? null : closed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "vigilance" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          // Regression fix: this table had no row-link props at all, so a
          // vigilance case (a proceeding_type='major' disciplinary case --
          // see the status-enum comment above) had no way to reach its own
          // detail page from here. It already has one: the fully-built
          // disciplinary/[id] page (breadcrumbs, case fields, e-Office raise
          // action) is keyed by this same row's `id` and gated by the exact
          // same role list (VIGILANCE_ROLES here === DISCIPLINARY_ROLES
          // there), so rows link there -- mirroring hr/disciplinary/page.tsx's
          // own rowLinkKey/rowLinkPrefix wiring -- instead of duplicating a
          // second detail page for the same underlying case.
          rowLinkKey="id"
          rowLinkPrefix="/hr/disciplinary/"
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
