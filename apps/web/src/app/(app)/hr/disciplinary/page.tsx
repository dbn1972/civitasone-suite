import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's
 * HR_ROLES guard on GET /v1/hrms/disciplinary-cases exactly.
 */
const DISCIPLINARY_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type RawRow = {
  id: string;
  employee: string;
  department: string;
  proceeding_type: string;
  charges: string;
  filed_date: string;
  inquiry_officer: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string; type: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/disciplinary-cases", [], {
    telemetryKey: "hr.disciplinary",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DisciplinaryListPage() {
  const t = await getTranslations("disciplinary");
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => DISCIPLINARY_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="disciplinary cases" requiredRoles={DISCIPLINARY_ROLES} />;
  }

  const { data: rawItems, source } = await getData();
  const errored = source === "error";
  const items: Row[] = rawItems.map((r) => ({
    ...r,
    caseRef: (r.proceeding_type === "major" ? "VIG/" : "GRV/") + r.id.slice(0, 8).toUpperCase(),
    type: r.proceeding_type === "major" ? "Major (Vigilance)" : "Minor (Grievance)",
  }));

  const major = items.filter((i) => i.proceeding_type === "major").length;
  const minor = items.filter((i) => i.proceeding_type === "minor").length;
  // Real terminal statuses (disciplinary/state-machine.ts's CaseStatus) are
  // "closed" and "dropped" -- "disposed"/"finalised" are not real statuses
  // for this table, so a dropped (investigated-and-exonerated/discontinued)
  // case was never excluded here and stayed counted as "open" forever.
  const open = items.filter((i) => !["closed", "dropped"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "type", label: t("colType") },
    { key: "charges", label: t("colCharge") },
    { key: "inquiry_officer", label: t("colOfficer") },
    { key: "filed_date", label: t("colFiled") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<Link href="/hr/vigilance" className="btn-outline">{t("vigilanceOnly")}</Link>}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
<StatCard icon="⚖️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statMajor")} value={errored ? null : major} />
        <StatCard icon="🟡" iconBg="var(--warnbg, #fffbe6)" label={t("statMinor")} value={errored ? null : minor} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statOpen")} value={errored ? null : open} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "disciplinary" })} backHref="/hr" />
          </div>
        ) : (<>

        {/* Regression fix: this table had no row-link props at all, so the
            fully-built disciplinary/[id] detail page (breadcrumbs, case
            fields, e-Office raise action) was completely unreachable except
            by hand-typing a case UUID into the URL. */}
        <DataTable<Row>
          columns={columns}
          rows={items}
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
        </>)}
      </Card>
    </div>
  );
}
