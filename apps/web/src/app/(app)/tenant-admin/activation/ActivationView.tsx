"use client";

import { StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { Chart } from "../../../_components/Chart";
import { toHumanError } from "@/lib/messages";
import { FUNNEL_STEPS, type ActivationAggregate } from "@/lib/activation";

const STEP_LABELS: Record<string, string> = {
  signin: "Signed in",
  wizard_opened: "Opened setup",
  "org-profile": "Office details",
  branches: "Branch offices",
  departments: "Departments",
  people: "Invited team",
  modules: "Chose modules",
  first_transaction: "First real transaction",
};

type FunnelRow = {
  step: string;
  reached: number;
  dropped: string;
  retained: string;
} & Record<string, unknown>;

/**
 * Presentational, pure client component for the activation dashboard.
 *
 * GAP-TENANT-ADMIN-ACTIVATION-01 (FAILMASK): when `failed` is true the page
 * renders a retry error state, NOT zeroes/"no events yet" — an outage must be
 * distinguishable from a brand-new tenant.
 *
 * GAP-TENANT-ADMIN-ACTIVATION-03: for a single office (`platform === false`)
 * the "Offices signed in / activated" counts are only ever 0 or 1 and the
 * funnel is meaningless, so the tenant view shows a setup checklist and
 * time-to-first-transaction instead; platform scope keeps the office funnel.
 *
 * GAP-TENANT-ADMIN-ACTIVATION-04 (TABLE): a bar Chart of reached-per-step
 * above a responsive DataTable, replacing the old raw <table className="tbl">.
 */
export function ActivationView({
  agg,
  platform,
  failed,
}: {
  agg: ActivationAggregate;
  platform: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <Card title="Activation" padding>
        <RefreshErrorState error={toHumanError("load", { area: "activation events" })} backHref="/tenant-admin" />
      </Card>
    );
  }

  const ttfrt = agg.ttfrtMedianMinutes;
  const ttfrtDisplay = ttfrt === null ? "—" : ttfrt < 60 ? `${Math.round(ttfrt)} min` : `${(ttfrt / 60).toFixed(1)} hr`;

  // Per-step reached, for the chart + table (shared by both scopes).
  const stageByStep = new Map(agg.stages.map((s) => [s.step, s]));
  const chartData = FUNNEL_STEPS.map((step) => ({
    label: STEP_LABELS[step] ?? step,
    value: stageByStep.get(step)?.reached ?? 0,
  }));

  const empty = agg.totalOffices === 0;
  const officesSignedIn = agg.stages[0]?.reached ?? 0;

  return (
    <>
      <StatGrid>
        <StatCard icon="⏱" iconBg="#e7edfd" label="Time to first transaction (median)" value={ttfrtDisplay} />
        {platform ? (
          <>
            <StatCard icon="🏢" iconBg="#eff6ff" label="Offices signed in" value={officesSignedIn} />
            <StatCard icon="✅" iconBg="#ecfdf3" label="Offices activated" value={agg.activatedOffices} />
            <StatCard icon="📈" iconBg="#fffaeb" label="Activation rate" value={`${Math.round(agg.activationRate * 100)}%`} />
          </>
        ) : (
          <>
            {/* GAP-TENANT-ADMIN-ACTIVATION-03: a single office's "offices
                signed in/activated" is only ever 0 or 1 — meaningless. Show
                setup progress (steps completed of the golden path) instead. */}
            <StatCard
              icon="🪜"
              iconBg="#eff6ff"
              label="Setup progress"
              value={`${FUNNEL_STEPS.filter((s) => (stageByStep.get(s)?.reached ?? 0) > 0).length}/${FUNNEL_STEPS.length} steps`}
            />
            <StatCard
              icon="✅"
              iconBg="#ecfdf3"
              label="First transaction"
              value={(stageByStep.get("first_transaction")?.reached ?? 0) > 0 ? "Done" : "Not yet"}
            />
          </>
        )}
      </StatGrid>

      <Card title={platform ? "Golden-path funnel" : "Setup checklist"}>
        <div className="pad">
          {empty ? (
            <p style={{ color: "var(--mut)", fontSize: 14 }}>
              {platform
                ? "No activation events yet. As offices sign in and set up, their progress appears here."
                : "No activation events yet. As you work through setup, each completed step appears here."}
            </p>
          ) : (
            <>
              <Chart
                type="bar"
                title={platform ? "Offices reached per step" : "Steps reached"}
                data={chartData}
                height={200}
              />
              <DataTable<FunnelRow>
                columns={
                  platform
                    ? [
                        { key: "step", label: "Step" },
                        { key: "reached", label: "Offices reached" },
                        { key: "dropped", label: "Dropped here" },
                        { key: "retained", label: "Kept from previous" },
                      ]
                    : [
                        { key: "step", label: "Step" },
                        {
                          key: "reached",
                          label: "Status",
                          render: (r) => (r.reached > 0 ? <span className="pill good">Done</span> : <span className="pill mut">Not done</span>),
                        },
                      ]
                }
                rows={FUNNEL_STEPS.map((step) => {
                  const stage = stageByStep.get(step)!;
                  return {
                    step: STEP_LABELS[step] ?? step,
                    reached: stage.reached,
                    dropped: stage.droppedFromPrev > 0 ? `−${stage.droppedFromPrev}` : "—",
                    retained: `${Math.round(stage.retention * 100)}%`,
                  };
                })}
              />
            </>
          )}
        </div>
      </Card>

      {/* GAP-TENANT-ADMIN-ACTIVATION-02: accurate copy. The events are read
          from the analytics service (see loadEvents) — the old footer claimed
          both that they came from analytics AND that they were "kept in memory
          ... durable storage moves to the analytics service next", a
          contradiction. */}
      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 12.5 }}>
        Based on activation events recorded by the analytics service. The biggest single drop tells you the
        most important thing to fix next.
      </p>
    </>
  );
}
