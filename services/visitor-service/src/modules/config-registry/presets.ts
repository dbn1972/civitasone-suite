import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { deriveConfigId } from "./domain.js";
import { POLICY_NS, APPROVAL_NS } from "./policy.js";

/**
 * Vertical onboarding presets. Applying a preset seeds a tenant's config so two
 * government offices can run DIFFERENT policies with no code change — a strict
 * secretariat, a standard district office, and a long-retention hospital each
 * get a named bundle of `visitor_policy` scalar knobs plus (optionally) a
 * `visitor_approval` auto-approve set that REPLACES the default {vip}.
 *
 * Mirrors court-service's preset pattern: one call fans out idempotent
 * config.set commands (deterministic per (tenant, namespace, key)), so
 * re-applying a preset is a no-op / clean upsert.
 *
 * A `visitor_policy` entry carries the scalar `value` (number/boolean). A
 * `visitor_approval` entry's key IS the auto-approved visitor category; its
 * value is a marker object (the effectiveAllowed resolver keys off active
 * membership, not the value).
 */
export type PresetEntry = {
  namespace: string;
  configKey: string;
  value: unknown;
  label: string;
};

export const VERTICAL_PRESETS: Record<string, readonly PresetEntry[]> = {
  // Secretariat — high-security government HQ: short retention, aggressive
  // auto-reject, tight overstay escalation, strict anti-passback, no auto-approve
  // beyond the default {vip}. Short multi-day passes.
  secretariat: [
    { namespace: POLICY_NS, configKey: "retention.pii_days",              value: 180, label: "Retain visitor PII 180 days" },
    { namespace: POLICY_NS, configKey: "retention.erasure_sla_hours",     value: 48,  label: "Erasure within 48h" },
    { namespace: POLICY_NS, configKey: "visit_request.auto_reject_hours", value: 12,  label: "Auto-reject stale requests after 12h" },
    { namespace: POLICY_NS, configKey: "visit_request.no_show_hours",     value: 1,   label: "No-show after 1h" },
    { namespace: POLICY_NS, configKey: "check_in.overstay_escalation_hours", value: 1, label: "Escalate overstay after 1h" },
    { namespace: POLICY_NS, configKey: "check_in.overstay_grace_minutes", value: 0,   label: "No overstay grace" },
    { namespace: POLICY_NS, configKey: "digital_pass.multi_day_max_days", value: 3,   label: "Multi-day pass capped at 3 days" },
    { namespace: POLICY_NS, configKey: "turnstile.tailgating_tolerance",  value: 1,   label: "Tailgating tolerance 1" },
    { namespace: POLICY_NS, configKey: "turnstile.anti_passback_enabled", value: true, label: "Anti-passback enforced" },
  ],
  // District office — standard citizen-facing office: default retention/timers,
  // and routine vendors/contractors are auto-approved alongside VIPs.
  "district-office": [
    { namespace: POLICY_NS, configKey: "retention.pii_days",              value: 365, label: "Retain visitor PII 365 days" },
    { namespace: POLICY_NS, configKey: "visit_request.auto_reject_hours", value: 24,  label: "Auto-reject stale requests after 24h" },
    { namespace: POLICY_NS, configKey: "visit_request.no_show_hours",     value: 2,   label: "No-show after 2h" },
    { namespace: POLICY_NS, configKey: "check_in.overstay_grace_minutes", value: 15,  label: "15-minute overstay grace" },
    { namespace: APPROVAL_NS, configKey: "vip",        value: { autoApprove: true }, label: "Auto-approve VIP" },
    { namespace: APPROVAL_NS, configKey: "contractor", value: { autoApprove: true }, label: "Auto-approve contractors" },
  ],
  // Hospital — long-retention clinical setting: multi-year retention, long lead
  // window, extended recurring passes, lenient overstay grace for patient
  // visitors, and VIP + delegation auto-approval.
  hospital: [
    { namespace: POLICY_NS, configKey: "retention.pii_days",              value: 1825, label: "Retain visitor PII 5 years" },
    { namespace: POLICY_NS, configKey: "retention.erasure_sla_hours",     value: 72,   label: "Erasure within 72h" },
    { namespace: POLICY_NS, configKey: "visit_request.max_lead_days",     value: 90,   label: "Schedule up to 90 days out" },
    { namespace: POLICY_NS, configKey: "visit_request.no_show_hours",     value: 4,    label: "No-show after 4h" },
    { namespace: POLICY_NS, configKey: "check_in.overstay_grace_minutes", value: 30,   label: "30-minute overstay grace" },
    { namespace: POLICY_NS, configKey: "digital_pass.recurring_max_days", value: 180,  label: "Recurring passes up to 180 days" },
    { namespace: APPROVAL_NS, configKey: "vip",        value: { autoApprove: true }, label: "Auto-approve VIP" },
    { namespace: APPROVAL_NS, configKey: "delegation", value: { autoApprove: true }, label: "Auto-approve delegations" },
  ],
};

export const PRESET_NAMES: readonly string[] = Object.keys(VERTICAL_PRESETS);

export function getPreset(name: string): readonly PresetEntry[] | undefined {
  return VERTICAL_PRESETS[name];
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
  for (const e of entries) {
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
        value: e.value,
        label: e.label,
        id: configId,
        tenantId: ctx.tenantId,
      },
    });
  }
  return { accepted: true, preset: presetName, entries: entries.length };
}
