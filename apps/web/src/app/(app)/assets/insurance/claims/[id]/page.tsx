import Link from "next/link";
import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ClaimActions } from "../ClaimActions";
import { canDecideClaims, isDecidable } from "../claimRules";
import { mapClaimDetail, type ClaimDetail } from "./claimDetail";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapLabel(parts: string[]) {
  return (payload: unknown): string | null => {
    if (!isRecord(payload)) return null;
    const vals = parts.map((k) => payload[k]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return vals.length > 0 ? vals.join(" · ") : null;
  };
}

async function getClaim(id: string): Promise<LoaderResult<ClaimDetail | null>> {
  return fetchJson<unknown, ClaimDetail | null>(`/api/v1/assets/insurance/claims/${encodeURIComponent(id)}`, null, {
    telemetryKey: "assets.insurance.claimDetail",
    mapResponse: mapClaimDetail,
  });
}

async function getPolicyLabel(id: string): Promise<LoaderResult<string | null>> {
  return fetchJson<unknown, string | null>(`/api/v1/assets/insurance/policies/${encodeURIComponent(id)}`, null, {
    telemetryKey: "assets.insurance.claimPolicy",
    mapResponse: mapLabel(["policyNo", "insurer"]),
  });
}

async function getAssetLabel(id: string): Promise<LoaderResult<string | null>> {
  return fetchJson<unknown, string | null>(`/api/v1/assets/assets/${encodeURIComponent(id)}`, null, {
    telemetryKey: "assets.insurance.claimAsset",
    mapResponse: mapLabel(["code", "name"]),
  });
}

export default async function ClaimDetailPage({ params }: { params: { id: string } }) {
  const claimRes = await getClaim(params.id);
  const claim = claimRes.data;
  const back = { back: "/assets/insurance/claims", backLabel: "Insurance Claims" } as const;

  if (!claim) {
    const notFound = claimRes.source !== "error" || claimRes.status === 404;
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={notFound ? "Claim not found" : "Claim"} {...back} />
        {notFound ? (
          <EmptyState icon="🔍" title="Claim not found" message="This claim does not exist or the link is incorrect." />
        ) : (
          <LoadErrorState result={claimRes} area="insurance claim" backHref={back.back} backLabel={back.backLabel} />
        )}
      </div>
    );
  }

  const [policyRes, assetRes] = await Promise.all([
    getPolicyLabel(claim.policyId),
    claim.assetId ? getAssetLabel(claim.assetId) : Promise.resolve<LoaderResult<string | null>>({ data: null, source: "api" }),
  ]);
  const decidable = isDecidable(claim.status);
  const canDecide = canDecideClaims(getSessionRoles());

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Claim of ${formatMoney(claim.claimAmountMinor)}`}
        subtitle={`Filed ${formatIndianDate(claim.claimDate)}`}
        {...back}
        actions={<StatusPill status={claim.status} />}
      />

      <Card title="Claim Details" padding>
        <div className="fields">
          <div className="fld">
            <div className="l">Policy</div>
            <div className="v">
              <Link className="lnk" href={`/assets/insurance/${encodeURIComponent(claim.policyId)}`}>
                {policyRes.data ?? "View policy"}
              </Link>
            </div>
          </div>
          <div className="fld">
            <div className="l">Asset</div>
            <div className="v">
              {claim.assetId ? (
                <Link className="lnk" href={`/assets/${encodeURIComponent(claim.assetId)}`}>
                  {assetRes.data ?? "View asset"}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="fld"><div className="l">Claim Date</div><div className="v">{formatIndianDate(claim.claimDate)}</div></div>
          <div className="fld"><div className="l">Claim Amount</div><div className="v">{formatMoney(claim.claimAmountMinor)}</div></div>
          <div className="fld"><div className="l">Settled Amount</div><div className="v">{formatMoney(claim.settledAmountMinor)}</div></div>
          <div className="fld"><div className="l">Notes</div><div className="v" style={{ whiteSpace: "pre-wrap" }}>{claim.notes ?? "—"}</div></div>
        </div>
      </Card>

      {decidable && canDecide ? (
        <Card title="Decide this claim" padding>
          <ClaimActions claimId={claim.id} claimAmountMinor={claim.claimAmountMinor} />
        </Card>
      ) : null}
    </div>
  );
}
