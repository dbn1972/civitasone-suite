import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, LoadErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { formatIndianDate } from "@/lib/formatters";
import { RtiActions } from "../_components/RtiActions";

const RTI_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Detail = {
  id: string;
  referenceNo: string;
  applicantName: string | null;
  applicantContact: string | null;
  subject: string;
  requestText: string;
  responseText: string | null;
  appealText: string | null;
  receivedDate: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  daysToDue: number;
} & Record<string, unknown>;

async function getDetail(id: string): Promise<LoaderResult<Detail | null>> {
  return fetchJson<unknown, Detail | null>(`/api/v1/hrms/rti/requests/${id}`, null, {
    telemetryKey: "hr.rti_detail",
    mapResponse: (p) => {
      const body = (p as { data?: Detail })?.data;
      return body ?? null;
    },
  });
}

export default async function RtiDetailPage({ params }: { params: { id: string } }) {
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => RTI_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="RTI requests" requiredRoles={RTI_ROLES} backHref="/hr/rti" backLabel="Back to RTI register" />;
  }

  const t = await getTranslations("rtiRequests");
  const loaderResult = await getDetail(params.id);
  const { data: detail, status: httpStatus } = loaderResult;
  if (httpStatus === 404) notFound();
  if (!detail) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} back="/hr/rti" backLabel="Back to RTI register" />
        <Card title="Request details">
          <div className="pad">
            <LoadErrorState result={loaderResult} area="RTI request" backHref="/hr/rti" backLabel="Back to RTI register" module="RTI requests" requiredRoles={RTI_ROLES} />
          </div>
        </Card>
      </div>
    );
  }

  // GAP-HR-RTI-03: applicantName/applicantContact come back `null` from the
  // API when this caller isn't hr_admin/super_admin/the assigned PIO
  // (routes.ts's projectRtiDetail) -- shown as "Restricted", not blank.
  const applicantDisplay = detail.applicantName ?? t("restricted");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={detail.referenceNo}
        subtitle={detail.subject}
        back="/hr/rti" backLabel="Back to RTI register"
      />
      <Card title="Request details">
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 10, fontSize: 14 }}>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Applicant</dt>
            <dd style={{ margin: 0 }}>{applicantDisplay}</dd>
            {detail.applicantContact && (
              <>
                <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Contact</dt>
                <dd style={{ margin: 0 }}>{detail.applicantContact}</dd>
              </>
            )}
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Status</dt>
            <dd style={{ margin: 0 }}><StatusPill status={detail.status} /></dd>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Received</dt>
            <dd style={{ margin: 0 }}>{formatIndianDate(detail.receivedDate)}</dd>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Due date</dt>
            <dd style={{ margin: 0 }}>
              {formatIndianDate(detail.dueDate)}
              {detail.overdue && <span style={{ color: "var(--danger, #b91c1c)", marginInlineStart: 8 }}>({t("slaOverdueByDays", { days: Math.abs(detail.daysToDue) })})</span>}
            </dd>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Request</dt>
            <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detail.requestText}</dd>
            {detail.responseText && (
              <>
                <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Response</dt>
                <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detail.responseText}</dd>
              </>
            )}
            {detail.appealText && (
              <>
                <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Appeal</dt>
                <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detail.appealText}</dd>
              </>
            )}
          </dl>
          <RtiActions id={detail.id} status={detail.status} />
        </div>
      </Card>
    </div>
  );
}
