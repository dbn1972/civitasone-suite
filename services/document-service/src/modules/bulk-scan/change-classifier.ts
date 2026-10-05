/**
 * Direction-aware classification of settings / profile changes (pure). DEFAULT-DENY: any key the classifier does not
 * explicitly know is LOOSEN (a new config key can never silently apply without a second approver).
 *
 *   key                              TIGHTEN (applies immediately, audited)        NEUTRAL                  LOOSEN (super_admin approver)
 *   -------------------------------  --------------------------------------------  -----------------------  ------------------------------------------
 *   reviewThreshold                  raised                                                                  lowered
 *   malwareFailClosed                false -> true                                                           true -> false (reason required)
 *   filingMakerChecker               false -> true                                                           true -> false (reason required)
 *   providerChain (ORDERED; the      new chain = old chain with only CLOUD (non-                             EVERYTHING else: a cloud provider added
 *     first provider gets every      tesseract) providers removed, same relative                             anywhere, moved earlier or made primary,
 *     page)                          order, and the primary is unchanged or local                            tesseract removed, any reorder that
 *                                                                                                             changes the primary
 *                                                                    same id sequence (timeouts only)
 *   classification.* (minScore,      -                                                                       ANY change (direction depends on whether a
 *     uncertainMargin,                                                                                        preset doc type is set, so every change is
 *     uncertainBelow, docTypes, ...)                                                                          sensitive)
 *   defaultDocType (profile preset)  -                                                                       ANY change (a preset drives the classifier cross-check)
 *   bestOf.enabled                   true -> false                                                           false -> true
 *   bestOf.threshold                                                      while bestOf is off     changed while bestOf is on
 *   pii.policy.<type>                strengthened (flag < mask < redact)                                     weakened
 *   pii.reviewOnDetect               off -> on                                                               on -> off
 *   duplicatePolicy                  -                                                                       ANY change
 *   allowedLinkTargets               only targets removed                  reorder only             any target added (widened)
 *   retentionDaysByType,             -                                                                       ANY change, either direction
 *     nonFiledRetentionDays
 *   languages, dpi, preprocessingSteps, limits, concurrency, twoDigitYearPivot, maxAttempts, linkDefaults:  NEUTRAL
 *   anything else                    -                                                                       LOOSEN (unknown key)
 *
 * Overall direction: loosening + tightening = "mixed"; loosening only = "loosen"; tightening only (neutral fields may
 * accompany) = "tighten"; nothing security-relevant = "neutral".
 *
 * ROUTING
 *   tenant settings: "loosen" / "mixed"            -> change request, SENSITIVE (super_admin approver, maker != checker)
 *                    "tighten" and NO neutral field -> applied IMMEDIATELY (audited with before/after)
 *                    "tighten" + neutral fields, or "neutral" -> change request, non-sensitive (maker != checker, as before)
 *   profiles:        "loosen" / "mixed"            -> change request (super_admin approver)
 *                    "tighten" / "neutral"          -> applied directly (audited)
 *                    delete of a profile some batch still references -> change request; unreferenced delete -> direct
 *   Profiles are classified over the EFFECTIVE value (absent override inherits the tenant value; removing an override
 *   reverts to the tenant value; a profile key the classifier does not know is LOOSEN).
 *
 * The consumers re-classify on the server under the settings lock; routes only predict (the `requiresApproval` flag).
 */
import type { BulkScanSettings, ProfileConfig } from "./validators.js";

export type Direction = "tighten" | "loosen" | "neutral";
export interface FieldChange { path: string; direction: Direction; before?: unknown; after?: unknown }
export interface Classification { direction: Direction | "mixed"; fields: FieldChange[] }

/** An effective config: full tenant settings, or a profile-resolved view of them. */
export type EffectiveView = Record<string, unknown>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** Stable deep serialisation: object keys sorted recursively, array ORDER kept, undefined dropped. A pure key reorder compares equal. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  if (isRec(v)) {
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
  }
  return v === undefined ? "undefined" : JSON.stringify(v);
}
const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const small = (v: unknown): unknown => (JSON.stringify(v ?? null).length <= 400 ? v : "[large]");
const change = (path: string, direction: Direction, before: unknown, after: unknown): FieldChange => ({ path, direction, before: small(before), after: small(after) });
const loosen = (path: string, b: unknown, a: unknown): FieldChange => change(path, "loosen", b, a);

const NEUTRAL_KEYS = new Set(["languages", "dpi", "preprocessingSteps", "limits", "concurrency", "twoDigitYearPivot", "maxAttempts", "linkDefaults"]);
const ANY_CHANGE_LOOSENS = new Set(["duplicatePolicy", "retentionDaysByType", "nonFiledRetentionDays", "defaultDocType"]);
const PII_RANK: Record<string, number> = { flag: 0, mask: 1, redact: 2 };

const isLocal = (id: unknown): boolean => id === "tesseract";
const ids = (c: unknown): unknown[] | null => (Array.isArray(c) ? c.map((p) => (isRec(p) ? p.id : p)) : null);

function chainChange(before: unknown, after: unknown): FieldChange {
  const b = ids(before), a = ids(after);
  if (!b || !a || a.length === 0) return loosen("providerChain", before, after);
  if (sameJson(b, a)) return change("providerChain", "neutral", b, a);                    // timeouts only: same providers, same order
  // TIGHTEN only if `a` is `b` with some CLOUD providers removed (same relative order) and the primary is unchanged or local
  let j = 0, onlyCloudRemoved = true;
  for (const id of b) {
    if (j < a.length && a[j] === id) j++;
    else if (isLocal(id)) onlyCloudRemoved = false;
  }
  const subsequence = j === a.length;
  const primaryOk = a[0] === b[0] || isLocal(a[0]);
  return change("providerChain", subsequence && onlyCloudRemoved && primaryOk ? "tighten" : "loosen", b, a);
}

function classifyKey(key: string, o: unknown, n: unknown): FieldChange[] {
  if (sameJson(o, n)) return [];
  if (NEUTRAL_KEYS.has(key)) return [{ path: key, direction: "neutral" }];
  if (ANY_CHANGE_LOOSENS.has(key)) return [loosen(key, o, n)];
  switch (key) {
    case "reviewThreshold":
      return typeof o === "number" && typeof n === "number" ? [change(key, n > o ? "tighten" : "loosen", o, n)] : [loosen(key, o, n)];
    case "malwareFailClosed":
    case "filingMakerChecker":
      return typeof o === "boolean" && typeof n === "boolean" ? [change(key, n ? "tighten" : "loosen", o, n)] : [loosen(key, o, n)];
    case "providerChain":
      return [chainChange(o, n)];
    case "allowedLinkTargets": {
      if (!Array.isArray(o) || !Array.isArray(n)) return [loosen(key, o, n)];
      const os = new Set(o), ns = new Set(n);
      if ([...ns].some((x) => !os.has(x))) return [loosen(key, o, n)];                 // widened
      if (ns.size < os.size) return [change(key, "tighten", o, n)];
      return [{ path: key, direction: "neutral" }];                                    // reorder only
    }
    case "bestOf": {
      const out: FieldChange[] = [];
      const ob = isRec(o) ? o : {}, nb = isRec(n) ? n : {};
      for (const k of new Set([...Object.keys(ob), ...Object.keys(nb)])) {
        if (sameJson(ob[k], nb[k])) continue;
        if (k === "enabled") out.push(change("bestOf.enabled", nb.enabled === true ? "loosen" : "tighten", ob.enabled, nb.enabled));
        else if (k === "threshold") out.push(nb.enabled === true ? loosen("bestOf.threshold", ob[k], nb[k]) : { path: "bestOf.threshold", direction: "neutral" });
        else out.push(loosen("bestOf." + k, ob[k], nb[k]));
      }
      return out;
    }
    case "pii": {
      const out: FieldChange[] = [];
      const op = isRec(o) ? o : {}, np = isRec(n) ? n : {};
      for (const k of new Set([...Object.keys(op), ...Object.keys(np)])) {
        if (sameJson(op[k], np[k])) continue;
        if (k === "reviewOnDetect") out.push(change("pii.reviewOnDetect", np[k] === true ? "tighten" : "loosen", op[k], np[k]));
        else if (k === "policy") {
          const opol = isRec(op.policy) ? op.policy : {}, npol = isRec(np.policy) ? np.policy : {};
          for (const t of new Set([...Object.keys(opol), ...Object.keys(npol)])) {
            if (sameJson(opol[t], npol[t])) continue;
            const ro = PII_RANK[String(opol[t])], rn = PII_RANK[String(npol[t])];
            out.push(ro === undefined || rn === undefined || rn < ro ? loosen("pii.policy." + t, opol[t], npol[t]) : change("pii.policy." + t, "tighten", opol[t], npol[t]));
          }
        } else out.push(loosen("pii." + k, op[k], np[k]));
      }
      return out;
    }
    case "classification": {
      // thresholds (minScore / uncertainMargin / uncertainBelow) move in opposite directions depending on whether a preset
      // doc type is set, so EVERY classification change (and any unknown sub-key) is sensitive
      const oc = isRec(o) ? o : {}, nc = isRec(n) ? n : {};
      return [...new Set([...Object.keys(oc), ...Object.keys(nc)])].filter((k) => !sameJson(oc[k], nc[k])).map((k) => loosen("classification." + k, oc[k], nc[k]));
    }
    default:
      return [loosen(key, o, n)];                                                      // unknown key: default-deny
  }
}

/** Classify old -> new over the union of their keys. */
export function classifyChange(oldCfg: EffectiveView, newCfg: EffectiveView): Classification {
  const fields: FieldChange[] = [];
  for (const k of new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)])) fields.push(...classifyKey(k, oldCfg[k], newCfg[k]));
  const hasLoosen = fields.some((f) => f.direction === "loosen"), hasTighten = fields.some((f) => f.direction === "tighten");
  const direction: Classification["direction"] = hasLoosen && hasTighten ? "mixed" : hasLoosen ? "loosen" : hasTighten ? "tighten" : "neutral";
  return { direction, fields };
}

export const needsApprovalDirection = (c: Classification): boolean => c.direction === "loosen" || c.direction === "mixed";

/** Tenant settings: applied immediately only when every changed field is a security TIGHTENING (no neutral field alongside). */
export const settingsApplyDirectly = (c: Classification): boolean => c.direction === "tighten" && !c.fields.some((f) => f.direction === "neutral");

/** before/after of the security fields that changed (audit detail; no free text, no PII). */
export function auditDiff(c: Classification): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const f of c.fields) if ("before" in f) { before[f.path] = f.before; after[f.path] = f.after; }
  return { before, after };
}

/**
 * The effective view of `base` (tenant settings) with a profile override block applied. null / absent override = inherit.
 * EVERY key of the override is copied (so a key the classifier does not know shows up as a change and is default-denied);
 * `defaultDocType` / `linkDefaults` are profile-only keys (absent on the tenant settings, so they default to null).
 */
export function profileView(base: BulkScanSettings, cfg: ProfileConfig | Record<string, unknown> | null | undefined): EffectiveView {
  const c = (cfg ?? {}) as Rec;
  const view: Rec = { ...(base as unknown as Rec), defaultDocType: null, linkDefaults: null, ...c };
  view.classification = { ...base.classification, ...(isRec(c.classification) ? c.classification : {}) };
  view.bestOf = { ...base.bestOf, ...(isRec(c.bestOf) ? c.bestOf : {}) };
  return view;
}

/** Profile create (old = null), update (both) or config removal; classified over the effective values against the tenant `base`. */
export function classifyProfileChange(base: BulkScanSettings, oldConfig: Record<string, unknown> | null, newConfig: Record<string, unknown> | null): Classification {
  return classifyChange(profileView(base, oldConfig), profileView(base, newConfig));
}
