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

  const opened = items.filter((i) => i.status === "opened").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "finalised"].includes(i.status)).length;

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label={t("statTotalCasesLabel")} value={errored ? null : items.length} />
        <StatCard icon="🔴" iconBg="#fff1f0" label={t("statChargeMemoStageLabel")} value={errored ? null : opened} />
        <StatCard icon="🔍" iconBg="#fffbe6" label={t("statUnderInquiryLabel")} value={errored ? null : inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statDisposedClosedLabel")} value={errored ? null : closed} />
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
    </main>
  );
}
