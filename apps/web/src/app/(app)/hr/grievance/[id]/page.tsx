import Link from "next/link";
import { PageHeader, Card, StatusPill, LoadErrorState } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { GRIEVANCE_ROLES, isOpenStatus } from "../grievanceModel";
import { GrievanceActions } from "./GrievanceActions";

type Detail = {
  id: string; caseNo: string; employeeId: string; employee: string; category: string;
  subject: string; description: string; filedDate: string; status: string;
  assignedTo: string | null; assignedToName: string | null; assignedAt: string | null;
  disposition: string | null; disposalRemarks: string | null; disposedAt: string | null;
  events: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string; note: string | null; assignedToName: string | null; createdAt: string }>;
};

/**
 * GAP-HR-GRIEVANCE-02: case detail -- the only place the free-text
 * description is shown (the register list never carries it). Opening it is an
 * audited read server-side. Assign / Dispose act through the grievance
 * commands; the history below is the append-only event log.
 */
export default async function GrievanceDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("grievanceDetail");
  const roles = getSessionRoles();
  if (!roles.some((r: string) => GRIEVANCE_ROLES.includes(r))) {
    return <PermissionDenied module="grievances" requiredRoles={GRIEVANCE_ROLES} />;
  }

  const result = await fetchJson<unknown, Detail | null>(
    `/api/v1/hrms/grievances/${encodeURIComponent(params.id)}`, null,
    { telemetryKey: "hr.grievance.detail", mapResponse: (p) => (p as { data?: Detail } | null)?.data ?? null },
  );
  const g = result.data;

  if (!g) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("notFoundTitle")} back="/hr/grievance" backLabel={t("backLabel")} />
        <LoadErrorState result={result} area="grievance" backHref="/hr/grievance" requiredRoles={GRIEVANCE_ROLES} />
      </div>
    );
  }

  const row = (label: string, value: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, padding: "6px 0" }}>
      <dt style={{ color: "var(--mut)", fontSize: 13 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );

  return (
    <div className="page-main wrap">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <Link href="/hr">{t("crumbHr")}</Link> <span aria-hidden="true">›</span>{" "}
        <Link href="/hr/grievance">{t("crumbGrievance")}</Link> <span aria-hidden="true">›</span> {g.caseNo}
      </nav>
      <PageHeader title={g.caseNo} subtitle={g.subject} back="/hr/grievance" backLabel={t("backLabel")} />
      <Card title={t("caseCardTitle")}>
        <div className="pad">
          <dl style={{ margin: 0 }}>
            {row(t("fieldEmployee"), g.employee)}
            {row(t("fieldCategory"), t(`category_${g.category}` as never))}
            {row(t("fieldFiled"), formatIndianDate(g.filedDate))}
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, padding: "6px 0" }}>
              <dt style={{ color: "var(--mut)", fontSize: 13 }}>{t("fieldStatus")}</dt>
              <dd style={{ margin: 0 }}><StatusPill status={g.status} /></dd>
            </div>
            {row(t("fieldOfficer"), g.assignedToName ?? t("unassigned"))}
            {g.disposition ? row(t("fieldDisposition"), t(`disposition_${g.disposition}` as never)) : null}
            {g.disposalRemarks ? row(t("fieldRemarks"), g.disposalRemarks) : null}
          </dl>
          <h3 style={{ fontSize: 14, margin: "14px 0 4px" }}>{t("descriptionTitle")}</h3>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{g.description}</p>
        </div>
      </Card>
      {isOpenStatus(g.status) ? (
        <Card title={t("actionsTitle")}>
          <div className="pad"><GrievanceActions id={g.id} grievantId={g.employeeId} /></div>
        </Card>
      ) : null}
      <Card title={t("historyTitle")}>
        <ol className="pad" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
          {g.events.map((e) => (
            <li key={e.id}>
              <strong>{t(`event_${e.action}` as never)}</strong>
              {e.assignedToName ? ` — ${e.assignedToName}` : ""}
              <span style={{ color: "var(--mut)" }}> · {formatIndianDate(e.createdAt)}</span>
              {e.note ? <div style={{ fontSize: 13 }}>{e.note}</div> : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
