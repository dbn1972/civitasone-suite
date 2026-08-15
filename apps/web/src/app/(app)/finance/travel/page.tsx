import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TravelClaimCard, type TravelClaimCardProps } from "./TravelClaimCard";

/**
 * TravelPage — TA/DA claims list with journey details and audit status.
 * GFR 2017 Chapter 19 / CCS (TA) Rules — entitlement governed by 7th CPC pay level.
 */

type ApiClaim = {
  id: string;
  employee?: { name?: string; employeeNo?: string; payLevel?: number };
  from: string;
  to: string;
  departureDate: string;
  returnDate?: string;
  purpose: string;
  fareClass: string;
  fareAmountMinor: number;
  daAmountMinor?: number;
  hotelAmountMinor?: number;
  hotelNights?: number;
  totalAmountMinor: number;
  auditStatus: string;
  auditRemark?: string;
};

function mapClaim(c: ApiClaim): TravelClaimCardProps {
  return {
    id: c.id,
    employeeName: c.employee?.name ?? "—",
    employeeNo: c.employee?.employeeNo ?? "—",
    payLevel: c.employee?.payLevel ?? 6,
    from: c.from,
    to: c.to,
    departureDate: c.departureDate,
    returnDate: c.returnDate ?? "—",
    purpose: c.purpose,
    fareClass: (c.fareClass ?? "AC-III") as TravelClaimCardProps["fareClass"],
    fareAmount: c.fareAmountMinor,
    daAmount: c.daAmountMinor ?? 0,
    hotelAmount: c.hotelAmountMinor ?? 0,
    hotelNights: c.hotelNights,
    totalAmount: c.totalAmountMinor,
    auditStatus: (c.auditStatus ?? "Pending") as TravelClaimCardProps["auditStatus"],
    auditRemark: c.auditRemark,
  };
}

async function getData(): Promise<LoaderResult<TravelClaimCardProps[]>> {
  return fetchJson<unknown, TravelClaimCardProps[]>("/api/v1/finance/travel-claims", [], {
    telemetryKey: "finance.travel",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiClaim[] })?.data;
      return Array.isArray(arr) ? (arr as ApiClaim[]).map(mapClaim) : null;
    },
  });
}

export default async function TravelPage() {
  const { data: claims, source } = await getData();

  const pending = claims.filter((c) => c.auditStatus === "Pending").length;
  const underAudit = claims.filter((c) => c.auditStatus === "Under Audit").length;
  const approved = claims.filter((c) => c.auditStatus === "Approved" || c.auditStatus === "Paid").length;
  const totalMinor = claims.reduce((s, c) => s + c.totalAmount, 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="TA / DA Claims"
        subtitle="Travel allowance and daily allowance claims. GFR 2017 Chapter 19 — entitlement by 7th CPC pay level."
        back="/finance"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="✈️" iconBg="#e6f0ff" label="Total Claims" value={claims.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="🔍" iconBg="#f0f4ff" label="Under Audit" value={underAudit} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved / Paid" value={approved} />
        <StatCard
          icon="₹"
          iconBg="#fef3f2"
          label="Total Claimed"
          value={`₹${(totalMinor / 100).toLocaleString("en-IN")}`}
        />
      </StatGrid>

      <Card title="TA/DA Claim Register">
        {claims.length === 0 ? (
          <EmptyState
            icon="✈️"
            title="No travel claims"
            message="TA/DA claims submitted by employees appear here for pre-audit. Entitlement is determined by 7th CPC pay level per CCS (TA) Rules."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
            {claims.map((c) => (
              <TravelClaimCard key={c.id} {...c} />
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
