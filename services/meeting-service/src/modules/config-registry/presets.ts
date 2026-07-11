import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { deriveConfigId } from "./domain.js";
import { POLICY_NS, COMMITTEE_TYPES_NS } from "./policy.js";

/**
 * Vertical onboarding presets. Applying a preset seeds a tenant's config so two
 * government bodies can run DIFFERENT governance policies with no code change — a
 * board of directors, a statutory committee, and a municipal council each get a
 * named bundle of `meeting_policy` scalar knobs plus (optionally) a
 * `meeting_committee_types` allowed-types set that REPLACES the default.
 *
 * Mirrors court/visitor's preset pattern: one call fans out idempotent config.set
 * commands (deterministic per (tenant, namespace, key)), so re-applying a preset is
 * a no-op / clean upsert.
 *
 * A `meeting_policy` entry carries the scalar `value` (number). A
 * `meeting_committee_types` entry's key IS the permitted committee type; its value
 * is a marker object (the effectiveAllowed resolver keys off active membership, not
 * the value).
 */
export type PresetEntry = {
  namespace: string;
  configKey: string;
  value: unknown;
  label: string;
};

export const VERTICAL_PRESETS: Record<string, readonly PresetEntry[]> = {
  // Board of directors — corporate/PSU board: statutory notice discipline, tight
  // minutes turnaround, aggressive action-item escalation, board-only body type.
  "board-of-directors": [
    { namespace: POLICY_NS, configKey: "agenda.submission_deadline_days",      value: 7,   label: "Agenda proposals due 7 days before" },
    { namespace: POLICY_NS, configKey: "minutes.submission_deadline_days",     value: 3,   label: "Draft minutes within 3 days" },
    { namespace: POLICY_NS, configKey: "minutes.deadline_alert_lead_days",     value: 1,   label: "Minutes deadline alert 1 day ahead" },
    { namespace: POLICY_NS, configKey: "committee.tenure_advance_notice_days", value: 45,  label: "Tenure expiry notice 45 days ahead" },
    { namespace: POLICY_NS, configKey: "action_item.escalation_l1_hours",      value: 12,  label: "Escalate to supervisor after 12h" },
    { namespace: POLICY_NS, configKey: "action_item.escalation_l2_hours",      value: 48,  label: "Escalate to head after 48h" },
    { namespace: POLICY_NS, configKey: "action_item.escalation_l3_hours",      value: 120, label: "Escalate to chair after 5 days" },
    { namespace: COMMITTEE_TYPES_NS, configKey: "board", value: { allowed: true }, label: "Permit board committees" },
  ],
  // Statutory committee — GFR/Act-mandated body: standard statutory windows, long
  // tenure notice, only statutory + standing bodies permitted.
  "statutory-committee": [
    { namespace: POLICY_NS, configKey: "agenda.submission_deadline_days",      value: 10,  label: "Agenda proposals due 10 days before" },
    { namespace: POLICY_NS, configKey: "minutes.submission_deadline_days",     value: 7,   label: "Draft minutes within 7 days" },
    { namespace: POLICY_NS, configKey: "committee.tenure_advance_notice_days", value: 60,  label: "Tenure expiry notice 60 days ahead" },
    { namespace: COMMITTEE_TYPES_NS, configKey: "statutory", value: { allowed: true }, label: "Permit statutory committees" },
    { namespace: COMMITTEE_TYPES_NS, configKey: "standing",  value: { allowed: true }, label: "Permit standing committees" },
  ],
  // Municipal council — ULB general body: relaxed agenda lead time, lenient
  // escalation, longer minutes window, standing + ad_hoc bodies.
  "municipal-council": [
    { namespace: POLICY_NS, configKey: "agenda.submission_deadline_days",      value: 5,   label: "Agenda proposals due 5 days before" },
    { namespace: POLICY_NS, configKey: "agenda.default_item_duration_minutes", value: 20,  label: "Default agenda item 20 min" },
    { namespace: POLICY_NS, configKey: "minutes.submission_deadline_days",     value: 14,  label: "Draft minutes within 14 days" },
    { namespace: POLICY_NS, configKey: "action_item.escalation_l1_hours",      value: 48,  label: "Escalate to supervisor after 48h" },
    { namespace: COMMITTEE_TYPES_NS, configKey: "standing", value: { allowed: true }, label: "Permit standing committees" },
    { namespace: COMMITTEE_TYPES_NS, configKey: "ad_hoc",   value: { allowed: true }, label: "Permit ad-hoc committees" },
  ],
};

export const PRESET_NAMES: readonly string[] = Object.keys(VERTICAL_PRESETS);

export function getPreset(name: string): readonly PresetEntry[] | undefined {
  return VERTICAL_PRESETS[name];
}

export type ApplyPresetResult = { accepted: true; preset: string; entries: number };

/**
 * Apply a vertical preset to the caller's tenant: fan out one idempotent
 * config.set command per entry. Re-applying the same preset is a no-op (the config
 * id is deterministic per (tenant, namespace, key)). Unknown preset → 400.
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
