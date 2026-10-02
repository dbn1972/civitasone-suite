import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, DataTable, LoadErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { formatIndianDate } from "@/lib/formatters";
import { RecordHearingForm } from "./RecordHearingForm";

// Mirrors the backend's own IDENTITY_ROLES exactly (services/hrms-service/
// src/modules/disciplinary/icc-routes.ts) -- GAP-HR-ICC-02's decision-
// packet default: identity only through this dedicated, icc_member-only
// route. Deliberately excludes hr_admin/super_admin (see that file's own
// comment) -- a chairing hr_admin needs the icc_member role granted to
// them, not a code bypass here.
const IDENTITY_ROLES = ["icc_member"];

// GAP-HR-ICC-03: statutory 90-day inquiry clock (POSH Act 2013, s.11 --
// the Internal Committee must complete an inquiry within 90 days of the
// complaint).
const INQUIRY_DAYS = 90;

type Detail = {
  id: string;
  caseNo: string;
  complainantId: string;
  respondentId: string | null;
  summary: string;
  filedAt: string;
  status: string;
  confidential: boolean;
};

type Hearing = {
  id: string;
  hearingDate: string;
  notes: string | null;
  finding: string | null;
  createdAt: string;
};

type EmployeeName = { id: string; name: string };

async function getDetail(id: string): Promise<LoaderResult<Detail | null>> {
  return fetchJson<unknown, Detail | null>(`/api/v1/hrms/icc/complaints/${id}`, null, {
    telemetryKey: "hr.icc_detail",
    mapResponse: (p) => (p as { data?: Detail })?.data ?? null,
  });
}

async function getHearings(id: string): Promise<Hearing[]> {
  const { data } = await fetchJson<unknown, Hearing[]>(`/api/v1/hrms/icc/complaints/${id}/hearings`, [], {
    telemetryKey: "hr.icc_hearings",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Hearing[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return data;
}

// A complaint always has a complainant, so the id list is never empty -- no
// "nothing to look up" branch is needed (and none is dressed up as an empty
// state).
async function resolveNames(complainantId: string, respondentId: string | null): Promise<Map<string, string>> {
  const uniqueIds = [...new Set([complainantId, ...(respondentId ? [respondentId] : [])])];
  const { data } = await fetchJson<unknown, EmployeeName[]>(`/api/v1/hrms/employees?ids=${uniqueIds.map(encodeURIComponent).join(",")}`, [], {
    telemetryKey: "hr.icc_identity_names",
    mapResponse: (p) => {
      const body = p as { data?: EmployeeName[] } | EmployeeName[];
      const arr = Array.isArray(body) ? body : body?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return new Map(data.map((e) => [e.id, e.name]));
}

function daysRemaining(filedAt: string): number {
  const filed = new Date(filedAt);
  const due = new Date(filed.getTime() + INQUIRY_DAYS * 86_400_000);
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
}

export default async function IccDetailPage({ params }: { params: { id: string } }) {
  const roles = getSessionRoles();
  if (!roles.some((r) => IDENTITY_ROLES.includes(r))) {
    return (
      <PermissionDenied
        module="ICC complaint detail"
        requiredRoles={IDENTITY_ROLES}
        reason="Complainant/respondent identity is restricted to nominated ICC members under POSH Act 2013, §16."
        backHref="/hr/icc"
        backLabel="Back to ICC register"
      />
    );
  }

  const loaderResult = await getDetail(params.id);
  const { data: detail, status: httpStatus } = loaderResult;
  if (httpStatus === 404) notFound();
  if (!detail) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="ICC complaint" back="/hr/icc" backLabel="Back to ICC register" />
        <Card title="Complaint details">
          <div className="pad">
            <LoadErrorState result={loaderResult} area="ICC complaint" backHref="/hr/icc" backLabel="Back to ICC register" module="ICC complaint detail" requiredRoles={IDENTITY_ROLES} />
          </div>
        </Card>
      </div>
    );
  }

  const [hearings, names] = await Promise.all([
    getHearings(detail.id),
    resolveNames(detail.complainantId, detail.respondentId),
  ]);

  const remaining = daysRemaining(detail.filedAt);
  const isOpen = !["closed", "disposed", "withdrawn"].includes(detail.status);

  const hearingColumns: { key: keyof Hearing & string; label: string; cellType?: "date" }[] = [
    { key: "hearingDate", label: "Hearing date", cellType: "date" },
    { key: "finding", label: "Finding" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={detail.caseNo} subtitle="Confidential — POSH Act 2013, §16" back="/hr/icc" backLabel="Back to ICC register" />

      {isOpen && (
        <div
          role="note"
          className="chip"
          style={{
            marginBottom: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: remaining < 15 ? "var(--badbg, #fff1f0)" : undefined,
            color: remaining < 15 ? "var(--danger, #b91c1c)" : undefined,
          }}
        >
          <span aria-hidden>⏱️</span>
          {remaining < 0
            ? `Inquiry overdue by ${Math.abs(remaining)} days (90-day statutory limit)`
            : `${remaining} days left of the 90-day statutory inquiry period`}
        </div>
      )}

      <Card title="Complaint details">
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 10, fontSize: 14 }}>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Complainant</dt>
            <dd style={{ margin: 0 }}>{names.get(detail.complainantId) ?? detail.complainantId}</dd>
            {detail.respondentId && (
              <>
                <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Respondent</dt>
                <dd style={{ margin: 0 }}>{names.get(detail.respondentId) ?? detail.respondentId}</dd>
              </>
            )}
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Status</dt>
            <dd style={{ margin: 0 }}><StatusPill status={detail.status} /></dd>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Filed</dt>
            <dd style={{ margin: 0 }}>{formatIndianDate(detail.filedAt)}</dd>
            <dt style={{ fontWeight: 700, color: "var(--muted)" }}>Summary</dt>
            <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detail.summary}</dd>
          </dl>
        </div>
      </Card>

      <Card title="Hearings">
        <div className="pad" style={{ display: "grid", gap: 16 }}>
          <DataTable<Hearing>
            columns={hearingColumns}
            rows={hearings}
            emptyIcon="📋"
            emptyTitle="No hearings recorded yet"
            emptyMessage="Record the first hearing below."
          />
          {isOpen && <RecordHearingForm complaintId={detail.id} />}
        </div>
      </Card>
    </div>
  );
}
