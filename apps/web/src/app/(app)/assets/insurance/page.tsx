import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { PolicyForm } from "./PolicyForm";

export type AssetOption = {
  id: string;
  code: string;
  name: string;
};

export type PolicyRow = {
  id: string;
  assetId: string;
  policyNo: string;
  insurer: string;
  coverageMinor: string;
  premiumMinor: string;
  currency: string;
  startDate: string;
  endDate: string;
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

function mapAssets(payload: unknown): AssetOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: AssetOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      id,
      code: typeof raw.code === "string" ? raw.code : "",
      name: typeof raw.name === "string" ? raw.name : "",
    });
  }
  return mapped;
}

function mapPolicies(payload: unknown): PolicyRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: PolicyRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const assetId = raw.assetId;
    const policyNo = raw.policyNo;
    if (typeof id !== "string" || typeof assetId !== "string" || typeof policyNo !== "string") continue;
    mapped.push({
      id,
      assetId,
      policyNo,
      insurer: typeof raw.insurer === "string" ? raw.insurer : "—",
      coverageMinor: String(raw.coverageMinor ?? 0),
      premiumMinor: String(raw.premiumMinor ?? 0),
      currency: typeof raw.currency === "string" ? raw.currency : "INR",
      startDate: typeof raw.startDate === "string" ? raw.startDate : "",
      endDate: typeof raw.endDate === "string" ? raw.endDate : "",
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getAssets(): Promise<LoaderResult<AssetOption[]>> {
  return fetchJson<unknown, AssetOption[]>("/api/v1/assets/assets?limit=200", [], {
    telemetryKey: "assets.insurance.assets",
    mapResponse: mapAssets,
  });
}

async function getPolicies(): Promise<LoaderResult<PolicyRow[]>> {
  return fetchJson<unknown, PolicyRow[]>("/api/v1/assets/insurance/policies?limit=200", [], {
    telemetryKey: "assets.insurance.policies",
    mapResponse: mapPolicies,
  });
}

export default async function InsurancePoliciesPage() {
  const { data: assets, source: assetsSource } = await getAssets();
  const { data: policies, source: policiesSource } = await getPolicies();

  const overallSource = assetsSource === "error" || policiesSource === "error" ? "error" : "api";

  const today = new Date().toISOString().slice(0, 10);
  const activePolicies = policies.filter((p) => p.status === "active").length;
  const expiringSoon = policies.filter((p) => {
    if (p.status !== "active" || !p.endDate) return false;
    const days = (new Date(p.endDate).getTime() - new Date(today).getTime()) / 86_400_000;
    return days >= 0 && days <= 30;
  }).length;
  const expired = policies.filter((p) => p.endDate && p.endDate < today && p.status === "active").length;

  const assetLookup = new Map(assets.map((a) => [a.id, a]));
  const rows = policies.map((p) => {
    const asset = assetLookup.get(p.assetId);
    return {
      ...p,
      assetLabel: asset ? [asset.code, asset.name].filter(Boolean).join(" · ") || asset.id : p.assetId,
      startDateDisplay: formatIndianDate(p.startDate),
      endDateDisplay: formatIndianDate(p.endDate),
    };
  });

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Asset Insurance"
        subtitle="Insurance policies covering registered assets, and claims filed against them."
        back="/assets"
        actions={
          <>
            {overallSource === "error" ? <DataSourceBadge source="error" /> : null}
            <a href="/assets/insurance/claims" className="btn ghost">
              View Claims
            </a>
          </>
        }
      />

      {policiesSource === "error" && policies.length === 0 ? (
        <Card title="Policies">
          <DataSourceBadge source="error" />
        </Card>
      ) : (
        <StatGrid>
          <StatCard icon="🛡️" iconBg="#e6f0ff" label="Total Policies" value={policies.length} />
          <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activePolicies} />
          <StatCard icon="⏳" iconBg="#fff2e6" label="Expiring in 30 Days" value={expiringSoon} />
          <StatCard icon="⚠️" iconBg="#fef3f2" label="Lapsed" value={expired} />
        </StatGrid>
      )}

      <PolicyForm assets={assets} />

      <Card title="Policies">
        {policiesSource === "error" && policies.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <DataTable<(typeof rows)[number]>
            columns={[
              { key: "policyNo", label: "Policy No." },
              { key: "assetLabel", label: "Asset" },
              { key: "insurer", label: "Insurer" },
              { key: "coverageMinor", label: "Sum Insured", align: "right", cellType: "amount" },
              { key: "premiumMinor", label: "Premium", align: "right", cellType: "amount" },
              { key: "startDateDisplay", label: "Start" },
              { key: "endDateDisplay", label: "End" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/insurance/"
            sortable
            filterable
            filterPlaceholder="Filter by policy number or insurer…"
            pageSize={15}
            emptyIcon="🛡️"
            emptyTitle="No insurance policies"
            emptyMessage="Create the first policy above to start tracking asset insurance."
          />
        )}
      </Card>
    </main>
  );
}
