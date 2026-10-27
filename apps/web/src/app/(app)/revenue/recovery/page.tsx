import { Button, PageHeader, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDateTime } from "@/lib/formatters";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { DecideActions } from "../_components/DecideActions";
import { RecoveryReferralCreateForm, type RecoveryReadiness } from "./RecoveryReferralCreateForm";
import { ServeNoticeForm } from "./ServeNoticeForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type RecoveryReferralRow = {
  id: string;
  assesseeId: string;
  reason: string;
  status: string | null;
  referredAt: string;
  /** The officer who raised the referral (maker); a different officer must decide it. */
  createdBy: string | null;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

function mapAssessees(payload: unknown): AssesseeOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: AssesseeOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const ownerName = raw.ownerName;
    if (typeof id !== "string" || typeof ownerName !== "string") continue;
    mapped.push({
      id,
      ownerName,
      identifierNo: typeof raw.identifierNo === "string" ? raw.identifierNo : "—",
      assesseeType: typeof raw.assesseeType === "string" ? raw.assesseeType : "—",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.recovery.assessees",
    mapResponse: mapAssessees,
  });
}

function mapReferrals(payload: unknown): RecoveryReferralRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: RecoveryReferralRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const assesseeId = raw.assesseeId;
    if (typeof id !== "string" || typeof assesseeId !== "string") continue;
    mapped.push({
      id,
      assesseeId,
      reason: typeof raw.reason === "string" ? raw.reason : "—",
      status: typeof raw.status === "string" ? raw.status : null,
      referredAt: typeof raw.referredAt === "string" ? raw.referredAt : "",
      createdBy: typeof raw.createdBy === "string" ? raw.createdBy : null,
    });
  }
  return mapped;
}

// Owner decision #4: amount outstanding, notices served and eligibility, shown before a referral.
function mapReadiness(payload: unknown): RecoveryReadiness | null {
  const body = isRecord(payload) && isRecord((payload as { data?: unknown }).data) ? ((payload as { data: Record<string, unknown> }).data) : null;
  if (!body || typeof body.outstandingMinor !== "string" || typeof body.eligible !== "boolean" || !Array.isArray(body.notices)) return null;
  const notices: RecoveryReadiness["notices"][number][] = [];
  for (const raw of body.notices) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    notices.push({
      id: raw.id,
      noticeNo: typeof raw.noticeNo === "string" ? raw.noticeNo : "—",
      servedOn: typeof raw.servedOn === "string" ? raw.servedOn : "",
      noticePeriodDays: Number(raw.noticePeriodDays ?? 0),
      lapsesOn: typeof raw.lapsesOn === "string" ? raw.lapsesOn : "",
      lapsed: raw.lapsed === true,
    });
  }
  return { outstandingMinor: body.outstandingMinor, eligible: body.eligible, notices };
}

async function getReadiness(assesseeId: string): Promise<LoaderResult<RecoveryReadiness | null>> {
  return fetchJson<unknown, RecoveryReadiness | null>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/recovery-readiness`,
    null,
    { telemetryKey: "revenue.recovery.readiness", mapResponse: mapReadiness },
  );
}

// Owner decision F1: the tenant's default notice period (the floor an officer may lengthen from).
async function getNoticeDefault(): Promise<number> {
  const r = await fetchJson<unknown, number>("/api/v1/revenue/recovery-settings", 15, {
    telemetryKey: "revenue.recovery.settings",
    mapResponse: (payload) => {
      const d = isRecord(payload) && isRecord((payload as { data?: unknown }).data) ? (payload as { data: Record<string, unknown> }).data : null;
      return d && Number.isInteger(d.defaultNoticePeriodDays) ? (d.defaultNoticePeriodDays as number) : null;
    },
  });
  return typeof r?.data === "number" ? r.data : 15;
}

async function getRecoveryReferrals(): Promise<LoaderResult<RecoveryReferralRow[]>> {
  return fetchJson<unknown, RecoveryReferralRow[]>("/api/v1/revenue/recovery-referrals?limit=200", [], {
    telemetryKey: "revenue.recovery.register",
    mapResponse: mapReferrals,
  });
}

export default async function RecoveryPage(
  props: {
    searchParams?: Promise<{ assesseeId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();
  const referralsResult = await getRecoveryReferrals();
  const referrals = referralsResult.data;
  const currentUserId = getSessionUserId();
  const pendingReferrals = referrals.filter((r) => r.status === "pending");
  // Fail closed: when the readiness could not be loaded the form is disabled (readiness = null).
  const readinessData = assesseeId ? (await getReadiness(assesseeId))?.data : undefined;
  const noticeDefault = assesseeId ? await getNoticeDefault() : 15;
  const readiness: RecoveryReadiness | null | undefined = !assesseeId
    ? undefined
    : readinessData && Array.isArray(readinessData.notices)
      ? readinessData
      : null;

  const nameById = new Map(assessees.map((a) => [a.id, a.ownerName] as const));
  const referralRows = referrals.map((r) => ({
    ...r,
    assesseeName: nameById.get(r.assesseeId) ?? r.assesseeId,
    referredAtDisplay: formatIndianDateTime(r.referredAt),
  }));

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Recovery Referrals"
        subtitle="Refer an assessee's arrears for coercive recovery action."
        back="/revenue"
        actions={assesseesSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="recovery-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="recovery-assessee-select"
              name="assesseeId"
              defaultValue={assesseeId}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                minHeight: 44,
                minWidth: 280,
              }}
            >
              <option value="">Select an assessee…</option>
              {assessees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} — {a.identifierNo} ({a.assesseeType})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>
            View
          </Button>
        </form>
      </Card>

      {!assesseeId ? (
        <Card title="Recovery Referrals">
          <EmptyState
            icon="⚖️"
            title="Choose an assessee"
            message="Select an assessee above to refer their arrears for recovery action."
          />
        </Card>
      ) : (
        <>
          <ServeNoticeForm assesseeId={assesseeId} defaultNoticePeriodDays={noticeDefault} />
          <RecoveryReferralCreateForm assesseeId={assesseeId} readiness={readiness} />
        </>
      )}

      {pendingReferrals.length > 0 && (
        <Card title="Awaiting approval" padding>
          <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "var(--ink2)" }}>
            A recovery referral is a coercive action, so a second officer must approve it before legal is told. The
            officer who raised a referral cannot decide it.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {pendingReferrals.map((r) => (
              <div key={r.id} style={{ display: "grid", gap: 8, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 13.5 }}>
                  <strong>{nameById.get(r.assesseeId) ?? r.assesseeId}</strong> — {r.reason}
                </div>
                <DecideActions
                  decideUrl={`v1/revenue/recovery-referrals/${r.id}/decide`}
                  noun="recovery referral"
                  status={r.status ?? "unknown"}
                  makerUserId={r.createdBy}
                  currentUserId={currentUserId}
                  summary={<>a recovery referral of <strong>{nameById.get(r.assesseeId) ?? r.assesseeId}</strong> for coercive action</>}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Recovery register" padding>
        {referralsResult.source === "error" ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load the recovery register.",
              next: "Retry in a moment. If it keeps failing, the revenue service may be unavailable.",
              actions: ["retry", "back"],
            }}
            backHref="/revenue"
          />
        ) : (
          <DataTable<(typeof referralRows)[number]>
            columns={[
              { key: "assesseeName", label: "Assessee" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "referredAtDisplay", label: "Referred On" },
              { key: "reason", label: "Reason" },
            ]}
            rows={referralRows}
            sortable
            filterable
            filterPlaceholder="Filter by assessee…"
            pageSize={15}
            emptyIcon="⚖️"
            emptyTitle="No recovery referrals yet"
            emptyMessage="Referrals you raise above will appear in this register."
          />
        )}
      </Card>
    </div>
  );
}
