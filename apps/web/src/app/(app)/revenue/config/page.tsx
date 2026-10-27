import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult, type LoaderSource } from "@/app/_data/apiClient";
import { formatBps, formatIndianDate, formatMoney } from "@/lib/formatters";
import { getSessionUserId, getSessionRoles } from "@/lib/auth/roleGuard";
import { RateConfigConsole } from "./RateConfigConsole";
import { ConfigProposalsPanel, type ConfigProposal } from "./ConfigProposalsPanel";
import type { ChangeTarget } from "./ProposeChangeForm";
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

// Owner decision #2: proposals awaiting a second officer, plus the recent decisions.
async function getProposals(): Promise<LoaderResult<ConfigProposal[]>> {
  return fetchJson<unknown, ConfigProposal[]>("/api/v1/revenue/rate-config/proposals?limit=50", [], {
    telemetryKey: "revenue.config.proposals",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ConfigProposal[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/** Rows that are still in force (not ended) — the ones a change or end-date can target. */
function buildChangeTargets(
  heads: RateHeadRow[],
  slabs: RateSlabRow[],
  penalties: PenaltyRuleRow[],
  rebates: RebateRuleRow[],
): ChangeTarget[] {
  const live = (r: { isActive: boolean; effectiveTo?: string | null }) => r.isActive && !r.effectiveTo;
  const from = (d?: string) => (d ? ` from ${formatIndianDate(d)}` : "");
  return [
    ...heads.filter(live).map((h) => ({ id: h.id, kind: "rate_head" as const, label: `${h.code} — ${h.name}` })),
    ...slabs.filter(live).map((s) => ({
      id: s.id, kind: "rate_slab" as const, slabType: s.slabType,
      label: `${s.slabType === "ad_valorem" ? formatBps(s.rateValue) : formatMoney(s.rateValue)} ${s.slabType}${from(s.effectiveFrom)}`,
    })),
    ...penalties.filter(live).map((r) => ({ id: r.id, kind: "penalty_rule" as const, label: `${r.interestType} ${formatBps(r.annualRateBps)} p.a.${from(r.effectiveFrom)}` })),
    ...rebates.filter(live).map((r) => ({ id: r.id, kind: "rebate_rule" as const, label: `${r.rebateType} ${formatBps(r.discountBps)}${from(r.effectiveFrom)}` })),
  ];
}

export default async function RateConfigPage(
  props: {
    searchParams?: Promise<{ rateHeadId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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

  const proposalsResult = await getProposals();
  const proposals = proposalsResult?.data ?? [];
  const currentUserId = getSessionUserId();
  // Owner decision F2: only these roles decide a rate-config proposal (the server enforces it too).
  const canApprove = getSessionRoles().some((r) => r === "revenue_admin" || r === "finance_admin");
  const changeTargets = buildChangeTargets(rateHeads, slabsResult.data, penaltyResult.data, rebateResult.data);

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
            <StatCard icon="🏷️" tone="info" label="Rate Heads" value={rateHeads.length} />
            <StatCard icon="✅" tone="good" label="Active Rate Heads" value={activeHeads} />
            <StatCard
              icon="📶"
              tone="warn"
              label="Rate Slabs (selected head)"
              value={slabsError ? null : slabsResult.data.length}
            />
            <StatCard
              icon="⚖️"
              tone="bad"
              label="Penalty Rules (selected head)"
              value={penaltyError ? null : penaltyResult.data.length}
            />
          </StatGrid>

          <ConfigProposalsPanel proposals={proposals} currentUserId={currentUserId} canApprove={canApprove} />

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
              changeTargets={changeTargets}
            />
          </Card>
        </>
      )}
    </div>
  );
}
