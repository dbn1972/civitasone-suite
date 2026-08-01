import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { ClaimForm } from "./ClaimForm";

export type PolicyOption = {
  id: string;
  policyNo: string;
  insurer: string;
  assetId: string;
  coverageMinor: string;
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

  const { data: policies, source: policiesSource } = await getPolicies();
  const { data: claims, source: claimsSource } = await getClaims();

  const overallSource = policiesSource === "error" || claimsSource === "error" ? "error" : "api";

  const pendingClaims = claims.filter((c) => c.status === "pending").length;
  const settledClaims = claims.filter((c) => c.status === "settled" || c.status === "closed").length;

  const policyLookup = new Map(policies.map((p) => [p.id, p]));
  const rows = claims.map((c) => {
    const policy = policyLookup.get(c.policyId);
    return {
      ...c,
      policyLabel: policy ? `${policy.policyNo} · ${policy.insurer}` : c.policyId,
      claimDateDisplay: formatIndianDate(c.claimDate),
    };
  });

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Insurance Claims"
        subtitle="Claims filed against asset insurance policies."
        back="/assets/insurance"
        backLabel="Asset Insurance"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {claimsSource === "error" && claims.length === 0 ? (
        <Card title="Claims">
          <DataSourceBadge source="error" />
        </Card>
      ) : (
        <StatGrid>
          <StatCard icon="📋" iconBg="#e6f0ff" label="Total Claims" value={claims.length} />
          <StatCard icon="⏳" iconBg="#fff2e6" label="Pending" value={pendingClaims} />
          <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={settledClaims} />
        </StatGrid>
      )}

      <ClaimForm policies={policies} preselectedPolicyId={preselectedPolicyId} />

      <Card title="Claims">
        {claimsSource === "error" && claims.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <DataTable<(typeof rows)[number]>
            columns={[
              { key: "policyLabel", label: "Policy" },
              { key: "claimDateDisplay", label: "Claim Date" },
              { key: "claimAmountMinor", label: "Claim Amount", align: "right", cellType: "amount" },
              { key: "settledAmountMinor", label: "Settled Amount", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by policy…"
            pageSize={15}
            emptyIcon="📋"
            emptyTitle="No claims filed"
            emptyMessage="File a claim above against an active policy."
          />
        )}
      </Card>
    </main>
  );
}
