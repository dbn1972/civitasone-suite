/**
 * Analytics commands — persist forecast runs.
 *
 * Writes go through a tenant-scoped transaction so the `app.tenant_id` GUC is
 * set and RLS FORCE on `analytics.forecast_runs` is satisfied.
 *
 * _Requirements: SVC-140_
 */
import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { forecastRuns } from "./schema.js";
import type { RequestContext } from "../../shared/context.js";
import type { ForecastResult } from "./domain.js";
import type { Granularity } from "./repo.js";

export interface PersistForecastInput {
  method: ForecastResult["method"];
  granularity: Granularity;
  param: number;
  rateHeadId?: string | undefined;
  series: bigint[];
  result: ForecastResult;
}

/**
 * Persist a computed forecast run. Returns the new row id.
 */
export async function persistForecastRun(ctx: RequestContext, input: PersistForecastInput): Promise<{ id: string }> {
  const row = {
    tenantId: ctx.tenantId,
    rateHeadId: input.rateHeadId ?? null,
    method: input.method,
    granularity: input.granularity,
    horizon: input.result.horizon,
    param: input.param,
    historyPeriods: input.result.historyPeriods,
    historySeries: input.series.map((v) => v.toString()),
    projections: input.result.projections.map((p) => ({
      index: p.index,
      projectionMinor: p.projectionMinor.toString(),
      lowerMinor: p.lowerMinor.toString(),
      upperMinor: p.upperMinor.toString(),
    })),
    madMinor: input.result.madMinor,
    confidenceBps: input.result.confidenceBps,
    createdBy: ctx.actorId,
  };

  const inserted = await tenantTransaction(db, ctx.tenantId, async (tx) => {
    const t = tx as typeof db;
    const res = await t.insert(forecastRuns).values(row).returning({ id: forecastRuns.id });
    return res;
  });

  return { id: (inserted as Array<{ id: string }>)[0]!.id };
}
