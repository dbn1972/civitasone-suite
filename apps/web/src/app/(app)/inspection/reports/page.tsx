import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, DataTable, EmptyState, PageHeader, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, formatShortId } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getInspectionReports } from "../_data/loaders";
import { REPORT_INSPECTOR_ROLES, REPORT_STATUS_KEYS, REPORT_TYPE_KEYS } from "./reportMeta";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  report: string;
  inspection: string;
  type: string;
  grade: string;
  status: string;
  created: string;
} & Record<string, unknown>;

/**
 * UAT Phase 2 C3 (J13): the inspection-report register. inspection-service
 * already exposed create / submit / approve, but the web app had no screen for
 * them, so an inspection report could not be raised at all.
 */
export default async function InspectionReportsPage(props: { searchParams?: Promise<{ created?: string; inspectionId?: string }> }) {
  const searchParams = (await props.searchParams) ?? {};
  const t = await getTranslations("inspectionReports");
  const inspectionId = typeof searchParams.inspectionId === "string" && searchParams.inspectionId ? searchParams.inspectionId : undefined;
  const { data, source } = await getInspectionReports(inspectionId);
  const canCreate = getSessionRoles().some((r) => REPORT_INSPECTOR_ROLES.includes(r));

  const rows: Row[] = data.map((r) => ({
    id: r.id,
    report: formatShortId(r.id),
    inspection: r.inspectionId ? formatShortId(r.inspectionId) : "—",
    type: r.reportType ? t(REPORT_TYPE_KEYS[r.reportType] ?? "typeStandard") : "—",
    grade: r.overallGrade ?? "—",
    status: r.status ?? "draft",
    created: r.createdAt ? formatIndianDate(r.createdAt) : "—",
  }));
  const statusLabels = Object.fromEntries(Object.entries(REPORT_STATUS_KEYS).map(([k, key]) => [k, t(key)]));
  const newHref = inspectionId ? `/inspection/reports/new?inspectionId=${encodeURIComponent(inspectionId)}` : "/inspection/reports/new";

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">{t("breadcrumbInspection")}</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">{t("title")}</span>
      </nav>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/inspection"
        actions={canCreate ? <Link href={newHref} className="btn primary">{t("newReport")}</Link> : undefined}
      />
      {searchParams.created ? (
        <p role="status" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {t("createdNotice")}{" "}
          <Link href="/inspection/reports" className="lnk">{t("refresh")}</Link>
        </p>
      ) : null}
      <Card>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "inspection reports" })} backHref="/inspection" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={canCreate ? <Link href={newHref} className="btn primary">{t("newReport")}</Link> : undefined}
          />
        ) : (
          <DataTable<Row>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/inspection/reports/"
            identifyingColumnKey="report"
            sortable
            pageSize={20}
            columns={[
              { key: "report", label: t("colReport") },
              { key: "inspection", label: t("colInspection") },
              { key: "type", label: t("colType") },
              { key: "grade", label: t("colGrade") },
              { key: "status", label: t("colStatus"), cellType: "status", statusLabels },
              { key: "created", label: t("colCreated") },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
