import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, DataTable, PageHeader, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, formatShortId } from "@/lib/formatters";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { getInspectionReportById } from "../../_data/loaders";
import {
  OBSERVABLE_STATUSES, REPORT_INSPECTOR_ROLES, REPORT_REVIEWER_ROLES, REPORT_STATUS_KEYS, REPORT_TYPE_KEYS, SEVERITY_KEYS, SUBMITTABLE_STATUSES, reportMakers,
} from "../reportMeta";
import { ReportActions } from "./ReportActions";

export const dynamic = "force-dynamic";

type ObsRow = { id: string; category: string; severity: string; description: string; location: string } & Record<string, unknown>;

/** UAT Phase 2 C3 (J13): one inspection report, its observations and its workflow actions. */
export default async function InspectionReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const t = await getTranslations("inspectionReports");
  const { data: report, source, status } = await getInspectionReportById(id);
  if (status === 404 || (source === "api" && !report)) notFound();
  if (source === "error" || !report) {
    return (
      <div className="wrap">
        <PageHeader title={t("detailTitle")} back="/inspection/reports" backLabel={t("backToReports")} />
        <RefreshErrorState error={toHumanError("load", { area: "inspection report" })} backHref="/inspection/reports" />
      </div>
    );
  }

  const roles = getSessionRoles();
  const me = getSessionUserId();
  const state = report.status ?? "draft";
  const isInspector = roles.some((r) => REPORT_INSPECTOR_ROLES.includes(r));
  const isReviewer = roles.some((r) => REPORT_REVIEWER_ROLES.includes(r));
  const statusLabel = t(REPORT_STATUS_KEYS[state] ?? "statusDraft");
  const obsRows: ObsRow[] = report.observations.map((o) => ({
    id: o.id,
    category: o.category,
    severity: t(SEVERITY_KEYS[o.severity] ?? "severityMinor"),
    description: o.description,
    location: o.location ?? "—",
  }));

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" data-dup-crumb style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">{t("breadcrumbInspection")}</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <Link href="/inspection/reports" className="lnk">{t("title")}</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">{formatShortId(report.id)}</span>
      </nav>
      <PageHeader title={t("detailTitle")} back="/inspection/reports" backLabel={t("backToReports")} />
      <Card>
        <dl className="kv">
          <dt>{t("fieldReport")}</dt>
          <dd>{report.id}</dd>
          <dt>{t("fieldStatus")}</dt>
          <dd><StatusPill status={state} label={statusLabel} /></dd>
          <dt>{t("fieldInspection")}</dt>
          <dd>{report.inspectionId ? <Link href={`/inspection/inspections/${report.inspectionId}`} className="lnk">{formatShortId(report.inspectionId)}</Link> : "—"}</dd>
          <dt>{t("fieldEntity")}</dt>
          <dd>{report.entityId ? formatShortId(report.entityId) : "—"}</dd>
          <dt>{t("fieldType")}</dt>
          <dd>{report.reportType ? t(REPORT_TYPE_KEYS[report.reportType] ?? "typeStandard") : "—"}</dd>
          <dt>{t("fieldGrade")}</dt>
          <dd>{report.overallGrade ?? "—"}</dd>
          <dt>{t("fieldSummary")}</dt>
          <dd style={{ whiteSpace: "pre-wrap" }}>{report.summary || "—"}</dd>
          <dt>{t("fieldRecommendations")}</dt>
          <dd style={{ whiteSpace: "pre-wrap" }}>{report.recommendations || "—"}</dd>
          <dt>{t("fieldSubmitted")}</dt>
          <dd>{report.submittedAt ? formatIndianDate(report.submittedAt) : "—"}</dd>
          <dt>{t("fieldApproved")}</dt>
          <dd>{report.approvedAt ? formatIndianDate(report.approvedAt) : "—"}</dd>
          {state === "rejected" ? (
            <>
              <dt>{t("fieldRejected")}</dt>
              <dd>{report.rejectedAt ? formatIndianDate(report.rejectedAt) : "—"}</dd>
              <dt>{t("fieldRejectionReason")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{report.rejectionReason || "—"}</dd>
            </>
          ) : null}
        </dl>
      </Card>
      {state === "rejected" ? (
        <p role="note" style={{ margin: "12px 0", fontSize: 14, color: "var(--bad)" }}>{t("rejectedNote")}</p>
      ) : null}
      {(isInspector || isReviewer) && state !== "approved" ? (
        <Card>
          <ReportActions
            reportId={report.id}
            canSubmit={isInspector && SUBMITTABLE_STATUSES.has(state)}
            resubmit={state === "rejected"}
            canApprove={isReviewer && state === "submitted"}
            canReject={isReviewer && state === "submitted"}
            isOwnReport={me !== null && reportMakers(report).includes(me)}
            canObserve={isInspector && OBSERVABLE_STATUSES.has(state)}
          />
        </Card>
      ) : null}
      <Card title={t("observationsTitle")}>
        {obsRows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink2)" }}>{t("noObservations")}</p>
        ) : (
          <DataTable<ObsRow>
            rows={obsRows}
            columns={[
              { key: "category", label: t("colCategory") },
              { key: "severity", label: t("colSeverity") },
              { key: "description", label: t("colDescription") },
              { key: "location", label: t("colLocation") },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
