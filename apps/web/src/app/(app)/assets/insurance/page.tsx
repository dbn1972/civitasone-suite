import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { PoliciesTable, type PolicyTableRow } from "./PoliciesTable";
import { PolicyForm } from "./PolicyForm";
import { derivePolicyStats } from "./policyStats";

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
      // GAP-ASSETS-INSURANCE-03: the other asset loaders read assetCode ?? code.
      code: typeof raw.assetCode === "string" && raw.assetCode ? raw.assetCode : typeof raw.code === "string" ? raw.code : "",
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

/** Shown in the Asset column when the policy's asset is not in the labels fetched for this page. */
const ASSET_FALLBACK_LABEL = "Asset (not in loaded list)";

export default async function InsurancePoliciesPage() {
  const assetsRes = await getAssets();
  const policiesRes = await getPolicies();
  const { data: assets } = assetsRes;
  const { data: policies } = policiesRes;

  // GAP-ASSETS-INSURANCE-05: ONE failure indicator -- the body's error state.
  // No header badge, no per-card badges, no zero stat tiles.
  const policiesFailed = policiesRes.source === "error";
  const assetsFailed = assetsRes.source === "error";

  // GAP-ASSETS-INSURANCE-04: IST "today"; each policy in exactly one bucket.
  const stats = derivePolicyStats(policies, todayIST());

  const assetLookup = new Map(assets.map((a) => [a.id, a]));
  const rows: PolicyTableRow[] = policies.map((p) => {
    const asset = assetLookup.get(p.assetId);
    const known = asset ? [asset.code, asset.name].filter(Boolean).join(" · ") : "";
    return {
      ...p,
      // GAP-ASSETS-INSURANCE-03: never a raw UUID in the Asset column.
      assetLabel: known || ASSET_FALLBACK_LABEL,
      startDateDisplay: formatIndianDate(p.startDate),
      endDateDisplay: formatIndianDate(p.endDate),
    };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Asset Insurance"
        subtitle="Insurance policies covering registered assets, and claims filed against them."
        back="/assets"
        actions={
          <Link href="/assets/insurance/claims" className="btn ghost">
            View Claims
          </Link>
        }
      />

      {policiesFailed ? (
        <LoadErrorState result={policiesRes} area="insurance policies" backHref="/assets" />
      ) : (
        <StatGrid>
          <StatCard icon="🛡️" iconBg="#e6f0ff" label="Total Policies" value={stats.total} />
          <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={stats.active} />
          <StatCard icon="⏳" iconBg="#fff2e6" label="Expiring in 30 Days" value={stats.expiring} />
          <StatCard icon="⚠️" iconBg="#fef3f2" label="Lapsed" value={stats.lapsed} />
          <StatCard icon="❔" iconBg="#f2f4f7" label="Other" value={stats.other} />
        </StatGrid>
      )}

      <PolicyForm
        disabledReason={
          assetsFailed ? "Couldn't load assets, so a policy can't be created right now. Refresh the page to try again." : undefined
        }
      />

      {policiesFailed ? null : (
        <Card title="Policies">
          <PoliciesTable rows={rows} />
        </Card>
      )}
    </div>
  );
}
