import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult, type LoaderSource } from "@/app/_data/apiClient";
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
  const slabsError = (slabsResult.source as LoaderSource) === "error";
  const penaltyError = (penaltyResult.source as LoaderSource) === "error";
  const rebateError = (rebateResult.source as LoaderSource) === "error";
  const anyError = rateHeadsSource === "error" || slabsError || penaltyError || rebateError;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Rate Configuration"
        subtitle="Configure rate heads, rate slabs, penalty (interest) rules, and rebate rules for the municipal rate engine."
        back="/revenue"
        actions={anyError ? <DataSourceBadge source="error" /> : null}
      />

      {rateHeadsSource === "error" ? (
        <RefreshErrorState
          error={{
            what: "We couldn't load the rate configuration.",
            next: "Retry in a moment. If it keeps failing, the revenue service may be unavailable.",
            actions: ["retry", "back"],
          }}
          backHref="/revenue"
        />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🏷️" iconBg="#eff6ff" label="Rate Heads" value={rateHeads.length} />
            <StatCard icon="✅" iconBg="#e6f7f0" label="Active Rate Heads" value={activeHeads} />
            <StatCard
              icon="📶"
              iconBg="#fffbe6"
              label="Rate Slabs (selected head)"
              value={slabsError ? null : slabsResult.data.length}
            />
            <StatCard
              icon="⚖️"
              iconBg="#fef3f2"
              label="Penalty Rules (selected head)"
              value={penaltyError ? null : penaltyResult.data.length}
            />
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
        </>
      )}
    </div>
  );
}
