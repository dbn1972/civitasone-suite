import { PageHeader, Card, DataTable, StatusPill, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import Link from "next/link";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { mapPolicyDetail, type PolicyDetail } from "./policyDetail";

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

/**
 * GAP-ASSETS-INSURANCE-DETAIL-01: resolve the insured asset's "code · name"
 * label (same /api/v1/assets prefix as the policy list's asset lookup). A
 * failed lookup only loses the label -- the link still renders.
 */
function mapAssetLabel(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const parts = [payload.code, payload.name].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function getAssetLabel(assetId: string): Promise<LoaderResult<string | null>> {
  return fetchJson<unknown, string | null>(`/api/v1/assets/assets/${encodeURIComponent(assetId)}`, null, {
    telemetryKey: "assets.insurance.policyAsset",
    mapResponse: mapAssetLabel,
  });
}

export default async function PolicyDetailPage({ params }: { params: { id: string } }) {
  const policyRes = await getPolicy(params.id);
  const claimsRes = await getClaimsForPolicy(params.id);
  const { data: policy } = policyRes;
  const { data: claims } = claimsRes;

  if (!policy) {
    // GAP-ASSETS-INSURANCE-DETAIL-03: only a real 404 (or an OK response with no
    // policy) is "not found"; every other failure -- including a 403 -- gets the
    // load-error state with the right retry / permission treatment.
    const notFound = policyRes.source !== "error" || policyRes.status === 404;
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={notFound ? "Policy not found" : "Policy"} back="/assets/insurance" backLabel="Asset Insurance" />
        {notFound ? (
          <EmptyState
            icon="🔍"
            title="Policy not found"
            message="This policy does not exist or the link is incorrect."
          />
        ) : (
          <LoadErrorState result={policyRes} area="insurance policy" backHref="/assets/insurance" backLabel="Asset Insurance" />
        )}
      </div>
    );
  }

  const claimRows = claims.map((c) => ({ ...c, claimDateDisplay: formatIndianDate(c.claimDate) }));
  const { data: assetLabel } = await getAssetLabel(policy.assetId);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`${policy.policyNo} · ${policy.insurer}`}
        subtitle="Insurance policy details and claims filed against it."
        back="/assets/insurance"
        backLabel="Asset Insurance"
        actions={<StatusPill status={policy.status} />}
      />

      <Card title="Policy Details" padding>
        <div className="fields">
          <div className="fld"><div className="l">Policy Number</div><div className="v">{policy.policyNo}</div></div>
          <div className="fld"><div className="l">Insurer</div><div className="v">{policy.insurer}</div></div>
          <div className="fld">
            <div className="l">Asset</div>
            <div className="v"><Link className="lnk" href={`/assets/${encodeURIComponent(policy.assetId)}`}>{assetLabel ?? "View asset"}</Link></div>
          </div>
          <div className="fld"><div className="l">Sum Insured</div><div className="v">{policy.coverageMinor === null ? "—" : formatMoney(policy.coverageMinor)}</div></div>
          <div className="fld"><div className="l">Premium</div><div className="v">{policy.premiumMinor === null ? "—" : formatMoney(policy.premiumMinor)}</div></div>
          <div className="fld"><div className="l">Start Date</div><div className="v">{formatIndianDate(policy.startDate)}</div></div>
          <div className="fld"><div className="l">End Date</div><div className="v">{formatIndianDate(policy.endDate)}</div></div>
          <div className="fld">
            <div className="l">Renewal Reminder</div>
            <div className="v">
              {policy.renewalReminderDays === null ? (
                <span style={{ color: "var(--ink2)" }}>Not set</span>
              ) : (
                `${policy.renewalReminderDays} days before expiry`
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Claims on this policy"
        link={
          <Link href={`/assets/insurance/claims?policyId=${encodeURIComponent(policy.id)}`} className="btn primary">
            File a Claim
          </Link>
        }
      >
        {claimsRes.source === "error" ? (
          <LoadErrorState result={claimsRes} area="claims on this policy" backHref="/assets/insurance" backLabel="Asset Insurance" />
        ) : (
          <DataTable<(typeof claimRows)[number]>
            columns={[
              { key: "claimDateDisplay", label: "Claim Date" },
              { key: "claimAmountMinor", label: "Claim Amount", align: "right", cellType: "amount" },
              { key: "settledAmountMinor", label: "Settled Amount", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={claimRows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/insurance/claims/"
            identifyingColumnKey="claimDateDisplay"
            sortable
            pageSize={15}
            emptyIcon="📋"
            emptyTitle="No claims filed"
            emptyMessage="No claims have been filed against this policy yet."
          />
        )}
      </Card>
    </div>
  );
}
