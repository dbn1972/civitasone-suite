import { PageHeader, Card, DataTable, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

export type PolicyDetail = {
  id: string;
  assetId: string;
  policyNo: string;
  insurer: string;
  coverageMinor: string;
  premiumMinor: string;
  currency: string;
  startDate: string;
  endDate: string;
  renewalReminderDays: number;
  status: string;
} & Record<string, unknown>;

export type ClaimRow = {
  id: string;
  policyId: string;
  assetId: string;
  claimDate: string;
  claimAmountMinor: string;
  settledAmountMinor: string;
  status: string;
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

function mapPolicyDetail(payload: unknown): PolicyDetail | null {
  if (!isRecord(payload)) return null;
  const id = payload.id;
  const assetId = payload.assetId;
  const policyNo = payload.policyNo;
  if (typeof id !== "string" || typeof assetId !== "string" || typeof policyNo !== "string") return null;
  return {
    id,
    assetId,
    policyNo,
    insurer: typeof payload.insurer === "string" ? payload.insurer : "—",
    coverageMinor: String(payload.coverageMinor ?? 0),
    premiumMinor: String(payload.premiumMinor ?? 0),
    currency: typeof payload.currency === "string" ? payload.currency : "INR",
    startDate: typeof payload.startDate === "string" ? payload.startDate : "",
    endDate: typeof payload.endDate === "string" ? payload.endDate : "",
    renewalReminderDays: typeof payload.renewalReminderDays === "number" ? payload.renewalReminderDays : 30,
    status: typeof payload.status === "string" ? payload.status : "unknown",
  };
}

function mapClaims(payload: unknown): ClaimRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: ClaimRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const policyId = raw.policyId;
    if (typeof id !== "string" || typeof policyId !== "string") continue;
    mapped.push({
      id,
      policyId,
      assetId: typeof raw.assetId === "string" ? raw.assetId : "",
      claimDate: typeof raw.claimDate === "string" ? raw.claimDate : "",
      claimAmountMinor: String(raw.claimAmountMinor ?? 0),
      settledAmountMinor: String(raw.settledAmountMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getPolicy(id: string): Promise<LoaderResult<PolicyDetail | null>> {
  return fetchJson<unknown, PolicyDetail | null>(`/api/v1/assets/insurance/policies/${encodeURIComponent(id)}`, null, {
    telemetryKey: "assets.insurance.policyDetail",
    mapResponse: mapPolicyDetail,
  });
}

async function getClaimsForPolicy(id: string): Promise<LoaderResult<ClaimRow[]>> {
  return fetchJson<unknown, ClaimRow[]>(`/api/v1/assets/insurance/claims?policyId=${encodeURIComponent(id)}`, [], {
    telemetryKey: "assets.insurance.policyClaims",
    mapResponse: mapClaims,
  });
}

export default async function PolicyDetailPage({ params }: { params: { id: string } }) {
  const { data: policy, source: policySource } = await getPolicy(params.id);
  const { data: claims, source: claimsSource } = await getClaimsForPolicy(params.id);

  const overallSource = policySource === "error" || claimsSource === "error" ? "error" : "api";

  if (!policy) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Policy not found" back="/assets/insurance" backLabel="Asset Insurance" />
        {policySource === "error" ? (
          <Card title="Policy">
            <DataSourceBadge source="error" />
          </Card>
        ) : (
          <EmptyState
            icon="🔍"
            title="Policy not found"
            message="The requested policy could not be found. It may have lapsed or the link is incorrect."
          />
        )}
      </main>
    );
  }

  const claimRows = claims.map((c) => ({ ...c, claimDateDisplay: formatIndianDate(c.claimDate) }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`${policy.policyNo} · ${policy.insurer}`}
        subtitle="Insurance policy details and claims filed against it."
        back="/assets/insurance"
        backLabel="Asset Insurance"
        actions={
          <>
            {overallSource === "error" ? <DataSourceBadge source="error" /> : null}
            <StatusPill status={policy.status} />
          </>
        }
      />

      <Card title="Policy Details" padding>
        <div className="fields">
          <div className="fld"><div className="l">Policy Number</div><div className="v">{policy.policyNo}</div></div>
          <div className="fld"><div className="l">Insurer</div><div className="v">{policy.insurer}</div></div>
          <div className="fld"><div className="l">Sum Insured</div><div className="v">{formatMoney(policy.coverageMinor)}</div></div>
          <div className="fld"><div className="l">Premium</div><div className="v">{formatMoney(policy.premiumMinor)}</div></div>
          <div className="fld"><div className="l">Start Date</div><div className="v">{formatIndianDate(policy.startDate)}</div></div>
          <div className="fld"><div className="l">End Date</div><div className="v">{formatIndianDate(policy.endDate)}</div></div>
          <div className="fld"><div className="l">Renewal Reminder</div><div className="v">{policy.renewalReminderDays} days before expiry</div></div>
        </div>
      </Card>

      <Card
        title="Claims on this policy"
        link={
          <a href={`/assets/insurance/claims?policyId=${encodeURIComponent(policy.id)}`} className="btn primary">
            File a Claim
          </a>
        }
      >
        {claimsSource === "error" && claims.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <DataTable<(typeof claimRows)[number]>
            columns={[
              { key: "claimDateDisplay", label: "Claim Date" },
              { key: "claimAmountMinor", label: "Claim Amount", align: "right", cellType: "amount" },
              { key: "settledAmountMinor", label: "Settled Amount", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={claimRows}
            sortable
            pageSize={15}
            emptyIcon="📋"
            emptyTitle="No claims filed"
            emptyMessage="No claims have been filed against this policy yet."
          />
        )}
      </Card>
    </main>
  );
}
