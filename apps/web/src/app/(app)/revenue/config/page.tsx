import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RateConfigConsole } from "./RateConfigConsole";
import type { RateHeadRow, RateSlabRow, PenaltyRuleRow, RebateRuleRow } from "./types";

async function getRateHeads(): Promise<LoaderResult<RateHeadRow[]>> {
  return fetchJson<unknown, RateHeadRow[]>("/api/v1/revenue/rate-heads", [], {
    telemetryKey: "revenue.config.rateHeads",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RateHeadRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getRateSlabs(rateHeadId: string): Promise<LoaderResult<RateSlabRow[]>> {
  return fetchJson<unknown, RateSlabRow[]>(
    `/api/v1/revenue/rate-slabs?rateHeadId=${encodeURIComponent(rateHeadId)}`,
    [],
    {
      telemetryKey: "revenue.config.rateSlabs",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: RateSlabRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
}

async function getPenaltyRules(rateHeadId: string): Promise<LoaderResult<PenaltyRuleRow[]>> {
  return fetchJson<unknown, PenaltyRuleRow[]>(
    `/api/v1/revenue/penalty-rules?rateHeadId=${encodeURIComponent(rateHeadId)}`,
    [],
    {
      telemetryKey: "revenue.config.penaltyRules",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: PenaltyRuleRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
}

async function getRebateRules(rateHeadId: string): Promise<LoaderResult<RebateRuleRow[]>> {
  return fetchJson<unknown, RebateRuleRow[]>(
    `/api/v1/revenue/rebate-rules?rateHeadId=${encodeURIComponent(rateHeadId)}`,
    [],
    {
      telemetryKey: "revenue.config.rebateRules",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: RebateRuleRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
}

export default async function RateConfigPage({
  searchParams,
}: {
  searchParams?: { rateHeadId?: string };
}) {
  const { data: rateHeads, source: rateHeadsSource } = await getRateHeads();

  const requestedId = searchParams?.rateHeadId;
  const selectedRateHeadId =
    requestedId && rateHeads.some((rh) => rh.id === requestedId) ? requestedId : (rateHeads[0]?.id ?? null);

  const [slabsResult, penaltyResult, rebateResult] = selectedRateHeadId
    ? await Promise.all([
        getRateSlabs(selectedRateHeadId),
        getPenaltyRules(selectedRateHeadId),
        getRebateRules(selectedRateHeadId),
      ])
    : [
        { data: [] as RateSlabRow[], source: "api" as const },
        { data: [] as PenaltyRuleRow[], source: "api" as const },
        { data: [] as RebateRuleRow[], source: "api" as const },
      ];

  const activeHeads = rateHeads.filter((rh) => rh.isActive).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Rate Configuration"
        subtitle="Configure rate heads, rate slabs, penalty (interest) rules, and rebate rules for the municipal rate engine."
        back="/revenue"
      />

      <StatGrid>
        <StatCard icon="🏷️" iconBg="#eff6ff" label="Rate Heads" value={rateHeads.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active Rate Heads" value={activeHeads} />
        <StatCard icon="📶" iconBg="#fffbe6" label="Rate Slabs (selected head)" value={slabsResult.data.length} />
        <StatCard icon="⚖️" iconBg="#fef3f2" label="Penalty Rules (selected head)" value={penaltyResult.data.length} />
      </StatGrid>

      <Card title="Rate Engine Configuration">
        <RateConfigConsole
          rateHeads={rateHeads}
          rateHeadsSource={rateHeadsSource}
          selectedRateHeadId={selectedRateHeadId}
          slabs={slabsResult.data}
          slabsSource={slabsResult.source}
          penaltyRules={penaltyResult.data}
          penaltyRulesSource={penaltyResult.source}
          rebateRules={rebateResult.data}
          rebateRulesSource={rebateResult.source}
        />
      </Card>
    </main>
  );
}
