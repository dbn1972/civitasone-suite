import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { ClaimForm } from "./ClaimForm";
import { POLICY_FALLBACK_LABEL } from "./claimRules";

export type PolicyOption = {
  id: string;
  policyNo: string;
  insurer: string;
  assetId: string;
  coverageMinor: string;
  /** "" when the API sent no date -- the form then cannot date-check against the policy. */
  startDate: string;
  endDate: string;
  status: string;
};

export type ClaimListRow = {
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

function mapPolicies(payload: unknown): PolicyOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: PolicyOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const policyNo = raw.policyNo;
    const assetId = raw.assetId;
    if (typeof id !== "string" || typeof policyNo !== "string" || typeof assetId !== "string") continue;
    mapped.push({
      id,
      policyNo,
      assetId,
      insurer: typeof raw.insurer === "string" ? raw.insurer : "—",
      coverageMinor: String(raw.coverageMinor ?? 0),
      startDate: typeof raw.startDate === "string" ? raw.startDate.slice(0, 10) : "",
      endDate: typeof raw.endDate === "string" ? raw.endDate.slice(0, 10) : "",
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

function mapClaims(payload: unknown): ClaimListRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: ClaimListRow[] = [];
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

async function getPolicies(): Promise<LoaderResult<PolicyOption[]>> {
  return fetchJson<unknown, PolicyOption[]>("/api/v1/assets/insurance/policies?limit=200", [], {
    telemetryKey: "assets.insurance.claims.policies",
    mapResponse: mapPolicies,
  });
}

async function getClaims(): Promise<LoaderResult<ClaimListRow[]>> {
  return fetchJson<unknown, ClaimListRow[]>("/api/v1/assets/insurance/claims?limit=200", [], {
    telemetryKey: "assets.insurance.claims.list",
    mapResponse: mapClaims,
  });
}

export default async function InsuranceClaimsPage({
  searchParams,
}: {
  searchParams?: { policyId?: string };
}) {
  const preselectedPolicyId = searchParams?.policyId?.trim() || "";

  const policiesRes = await getPolicies();
  const claimsRes = await getClaims();
  const { data: policies } = policiesRes;
  const { data: claims } = claimsRes;

  // GAP-ASSETS-INSURANCE-CLAIMS-05: one error panel in place of the stat
  // tiles and the table; no header badge, no repeated badges.
  const claimsFailed = claimsRes.source === "error";

  const pendingClaims = claims.filter((c) => c.status === "pending").length;
  // GAP-ASSETS-INSURANCE-CLAIMS-03: "Settled" and "Closed" are different outcomes -- count them apart.
  const settledClaims = claims.filter((c) => c.status === "settled").length;
  const closedClaims = claims.filter((c) => c.status === "closed").length;

  const policyLookup = new Map(policies.map((p) => [p.id, p]));
  const rows = claims.map((c) => {
    const policy = policyLookup.get(c.policyId);
    return {
      ...c,
      // GAP-ASSETS-INSURANCE-CLAIMS-04: never a raw UUID.
      policyLabel: policy ? `${policy.policyNo} · ${policy.insurer}` : POLICY_FALLBACK_LABEL,
      claimDateDisplay: formatIndianDate(c.claimDate),
    };
  });

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Insurance Claims"
        subtitle="Claims filed against asset insurance policies."
        back="/assets/insurance"
        backLabel="Asset Insurance"
      />

      {claimsFailed ? (
        <LoadErrorState result={claimsRes} area="insurance claims" backHref="/assets/insurance" backLabel="Asset Insurance" />
      ) : (
        <StatGrid>
          <StatCard icon="📋" iconBg="#e6f0ff" label="Total Claims" value={claims.length} />
          <StatCard icon="⏳" iconBg="#fff2e6" label="Pending" value={pendingClaims} />
          <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={settledClaims} />
          <StatCard icon="🗂️" iconBg="#f2f4f7" label="Closed" value={closedClaims} />
        </StatGrid>
      )}

      <ClaimForm policies={policies} preselectedPolicyId={preselectedPolicyId} policiesError={policiesRes.source === "error"} />

      {claimsFailed ? null : (
        <Card title="Claims">
          <DataTable<(typeof rows)[number]>
            columns={[
              { key: "policyLabel", label: "Policy" },
              { key: "claimDateDisplay", label: "Claim Date" },
              { key: "claimAmountMinor", label: "Claim Amount", align: "right", cellType: "amount" },
              { key: "settledAmountMinor", label: "Settled Amount", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/insurance/claims/"
            identifyingColumnKey="claimDateDisplay"
            sortable
            filterable
            filterPlaceholder="Filter by policy…"
            pageSize={15}
            emptyIcon="📋"
            emptyTitle="No claims filed"
            emptyMessage="File a claim above against an active policy."
          />
        </Card>
      )}
    </div>
  );
}
