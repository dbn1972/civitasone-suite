import { Button, PageHeader, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDateTime } from "@/lib/formatters";
import { RecoveryReferralCreateForm } from "./RecoveryReferralCreateForm";

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
    });
  }
  return mapped;
}

async function getRecoveryReferrals(): Promise<LoaderResult<RecoveryReferralRow[]>> {
  return fetchJson<unknown, RecoveryReferralRow[]>("/api/v1/revenue/recovery-referrals?limit=200", [], {
    telemetryKey: "revenue.recovery.register",
    mapResponse: mapReferrals,
  });
}

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();
  const referralsResult = await getRecoveryReferrals();
  const referrals = referralsResult.data;

  const nameById = new Map(assessees.map((a) => [a.id, a.ownerName] as const));
  const referralRows = referrals.map((r) => ({
    ...r,
    assesseeName: nameById.get(r.assesseeId) ?? r.assesseeId,
    referredAtDisplay: formatIndianDateTime(r.referredAt),
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
        <RecoveryReferralCreateForm assesseeId={assesseeId} />
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
