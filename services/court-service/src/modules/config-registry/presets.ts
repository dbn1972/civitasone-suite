import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { deriveConfigId } from "./domain.js";

/**
 * Vertical onboarding presets (§47). Applying a preset seeds a tenant's config
 * namespaces; because `effectiveAllowed` treats tenant config as AUTHORITATIVE
 * when present, a seeded tenant is then RESTRICTED to exactly that vertical's
 * court/case/order types — with no code change. This turns multi-vertical
 * onboarding (revenue / consumer / tribunal) into a single call that fans out
 * idempotent config.set commands (deterministic per (tenant, namespace, key)).
 */
export type PresetEntry = { namespace: string; configKey: string; label: string };

export const VERTICAL_PRESETS: Record<string, readonly PresetEntry[]> = {
  // Revenue / land administration courts (Tehsildar, SDM, Collector).
  revenue: [
    { namespace: "court_type", configKey: "tehsildar", label: "Tehsildar Court" },
    { namespace: "court_type", configKey: "sdm_court", label: "Sub-Divisional Magistrate Court" },
    { namespace: "court_type", configKey: "collector_court", label: "Collector Court" },
    { namespace: "court_type", configKey: "revenue_court", label: "Revenue Court" },
    { namespace: "case_type", configKey: "mutation", label: "Mutation" },
    { namespace: "case_type", configKey: "partition", label: "Partition" },
    { namespace: "case_type", configKey: "revenue_appeal", label: "Revenue Appeal" },
    { namespace: "case_type", configKey: "land_acquisition", label: "Land Acquisition" },
    { namespace: "case_type", configKey: "tenancy", label: "Tenancy" },
  ],
  // Consumer dispute redressal commissions (District / State).
  consumer: [
    { namespace: "court_type", configKey: "consumer_commission", label: "Consumer Disputes Redressal Commission" },
    { namespace: "case_type", configKey: "consumer_complaint", label: "Consumer Complaint" },
    { namespace: "case_type", configKey: "execution", label: "Execution" },
    { namespace: "case_type", configKey: "misc_application", label: "Miscellaneous Application" },
    { namespace: "order_type", configKey: "final_order", label: "Final Order" },
    { namespace: "order_type", configKey: "interim", label: "Interim Order" },
    { namespace: "order_type", configKey: "dismissal", label: "Dismissal" },
  ],
  // Administrative / statutory tribunals and appellate authorities.
  tribunal: [
    { namespace: "court_type", configKey: "tribunal", label: "Tribunal" },
    { namespace: "court_type", configKey: "appellate_authority", label: "Appellate Authority" },
    { namespace: "case_type", configKey: "revision", label: "Revision" },
    { namespace: "case_type", configKey: "review", label: "Review" },
    { namespace: "case_type", configKey: "misc_application", label: "Miscellaneous Application" },
    { namespace: "order_type", configKey: "final_order", label: "Final Order" },
  ],
};

export const PRESET_NAMES: readonly string[] = Object.keys(VERTICAL_PRESETS);

export function getPreset(name: string): readonly PresetEntry[] | undefined {
  return VERTICAL_PRESETS[name];
}

/**
 * FQ9 #7: max config.set publishes in flight while applying a preset. The previous serial
 * `for … await queue.publish` paid one broker round trip per entry back to back (SQS
 * ListQueues + SendMessage each), which on UAT exceeded the gateway's 15s upstream timeout
 * (504). The queue client has no batch-publish API, so entries are published with bounded
 * concurrency instead: every entry is independent and idempotent (deterministic ids), so
 * ordering does not matter, and the bound keeps a large preset from flooding the broker.
 */
export const PRESET_PUBLISH_CONCURRENCY = 8;

/** Run `fn` over `items` with at most `limit` calls in flight; rejects on the first failure. */
export async function forEachBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export type ApplyPresetResult = { accepted: true; preset: string; entries: number };

/**
 * Apply a vertical preset to the caller's tenant: fan out one idempotent
 * config.set command per entry. Re-applying the same preset is a no-op (the
 * config id is deterministic per (tenant, namespace, key)). Unknown preset → 400.
 */
export async function applyPreset(ctx: RequestContext, presetName: string): Promise<ApplyPresetResult> {
  const entries = getPreset(presetName);
  if (!entries) {
    throw new HttpError(400, "UNKNOWN_PRESET", `no vertical preset '${presetName}' (known: ${PRESET_NAMES.join(", ")})`);
  }
  await forEachBounded(entries, PRESET_PUBLISH_CONCURRENCY, async (e) => {
    const configId = deriveConfigId(ctx.tenantId, e.namespace, e.configKey);
    await queue.publish(COMMANDS.setConfig, {
      messageId: configId,
      type: COMMANDS.setConfig,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        namespace: e.namespace,
        configKey: e.configKey,
        value: { label: e.label },
        label: e.label,
        id: configId,
        tenantId: ctx.tenantId,
      },
    });
  });
  return { accepted: true, preset: presetName, entries: entries.length };
}
