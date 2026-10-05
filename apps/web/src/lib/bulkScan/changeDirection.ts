/**
 * Client-side MIRROR of the server's direction classifier (services/document-service/src/modules/bulk-scan/change-classifier.ts).
 * The server is authoritative; this only lets the forms say, per field and before submitting, whether a change applies
 * immediately or needs a second approver (super admin). DEFAULT-DENY like the server: any key not listed is LOOSENING.
 *
 *   reviewThreshold: raised tightens, lowered loosens.   malwareFailClosed / filingMakerChecker: ON tightens, OFF loosens.
 *   providerChain (ordered): tightens ONLY when the new chain is the old one with some cloud providers removed (same relative
 *     order) and the primary is unchanged or local; every other change (cloud added/moved earlier/primary, tesseract removed,
 *     primary-changing reorder) loosens; same ids in the same order (timeouts only) is neutral.
 *   classification.* (any), defaultDocType, duplicatePolicy, retentionDaysByType, nonFiledRetentionDays: ANY change loosens.
 *   bestOf.enabled: enabling loosens, disabling tightens; bestOf.threshold loosens only while best-of is on.
 *   pii.policy.<type>: weakening (flag < mask < redact) or an unknown value loosens, strengthening tightens;
 *     pii.reviewOnDetect on->off loosens, off->on tightens.   allowedLinkTargets: only removals tighten, any addition loosens.
 *   neutral: languages, dpi, preprocessingSteps, limits, concurrency, twoDigitYearPivot, maxAttempts, linkDefaults.
 * Any loosening field makes the whole change need approval.
 */
export type Direction = "tightening" | "loosening" | "unchanged";
type Dir3 = "tighten" | "loosen" | "neutral";
export interface FieldChange { path: string; direction: Dir3 }
export interface Classification { direction: Dir3 | "mixed"; fields: FieldChange[] }
export type View = Record<string, unknown>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** Key-order independent JSON (arrays keep their order). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isRec(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const f = (path: string, direction: Dir3): FieldChange[] => [{ path, direction }];

const NEUTRAL_KEYS = new Set(["languages", "dpi", "preprocessingSteps", "limits", "concurrency", "twoDigitYearPivot", "maxAttempts", "linkDefaults"]);
const ANY_CHANGE_LOOSENS = new Set(["duplicatePolicy", "retentionDaysByType", "nonFiledRetentionDays", "defaultDocType"]);
const PII_RANK: Record<string, number> = { flag: 0, mask: 1, redact: 2 };
const isLocal = (id: unknown): boolean => id === "tesseract";
const ids = (c: unknown): unknown[] | null => (Array.isArray(c) ? c.map((p) => (isRec(p) ? p.id : p)) : null);

function chainChange(before: unknown, after: unknown): FieldChange[] {
  const b = ids(before), a = ids(after);
  if (!b || !a || a.length === 0) return f("providerChain", "loosen");
  if (same(b, a)) return f("providerChain", "neutral");
  let j = 0, onlyCloudRemoved = true;
  for (const id of b) {
    if (j < a.length && a[j] === id) j++;
    else if (isLocal(id)) onlyCloudRemoved = false;
  }
  return f("providerChain", j === a.length && onlyCloudRemoved && (a[0] === b[0] || isLocal(a[0])) ? "tighten" : "loosen");
}

function classifyKey(key: string, o: unknown, n: unknown): FieldChange[] {
  if (same(o, n)) return [];
  if (NEUTRAL_KEYS.has(key)) return f(key, "neutral");
  if (ANY_CHANGE_LOOSENS.has(key)) return f(key, "loosen");
  switch (key) {
    case "reviewThreshold":
      return typeof o === "number" && typeof n === "number" ? f(key, n > o ? "tighten" : "loosen") : f(key, "loosen");
    case "malwareFailClosed":
    case "filingMakerChecker":
      return typeof o === "boolean" && typeof n === "boolean" ? f(key, n ? "tighten" : "loosen") : f(key, "loosen");
    case "providerChain":
      return chainChange(o, n);
    case "allowedLinkTargets": {
      if (!Array.isArray(o) || !Array.isArray(n)) return f(key, "loosen");
      const os = new Set(o), ns = new Set(n);
      if ([...ns].some((x) => !os.has(x))) return f(key, "loosen");
      return ns.size < os.size ? f(key, "tighten") : f(key, "neutral");
    }
    case "bestOf": {
      const out: FieldChange[] = [];
      const ob = isRec(o) ? o : {}, nb = isRec(n) ? n : {};
      for (const k of new Set([...Object.keys(ob), ...Object.keys(nb)])) {
        if (same(ob[k], nb[k])) continue;
        if (k === "enabled") out.push(...f("bestOf.enabled", nb.enabled === true ? "loosen" : "tighten"));
        else if (k === "threshold") out.push(...f("bestOf.threshold", nb.enabled === true ? "loosen" : "neutral"));
        else out.push(...f(`bestOf.${k}`, "loosen"));
      }
      return out;
    }
    case "pii": {
      const out: FieldChange[] = [];
      const op = isRec(o) ? o : {}, np = isRec(n) ? n : {};
      for (const k of new Set([...Object.keys(op), ...Object.keys(np)])) {
        if (same(op[k], np[k])) continue;
        if (k === "reviewOnDetect") out.push(...f("pii.reviewOnDetect", np[k] === true ? "tighten" : "loosen"));
        else if (k === "policy") {
          const opol = isRec(op.policy) ? op.policy : {}, npol = isRec(np.policy) ? np.policy : {};
          for (const t of new Set([...Object.keys(opol), ...Object.keys(npol)])) {
            if (same(opol[t], npol[t])) continue;
            const ro = PII_RANK[String(opol[t])], rn = PII_RANK[String(npol[t])];
            out.push(...f(`pii.policy.${t}`, ro === undefined || rn === undefined || rn < ro ? "loosen" : "tighten"));
          }
        } else out.push(...f(`pii.${k}`, "loosen"));
      }
      return out;
    }
    case "classification": {
      const oc = isRec(o) ? o : {}, nc = isRec(n) ? n : {};
      return [...new Set([...Object.keys(oc), ...Object.keys(nc)])].filter((k) => !same(oc[k], nc[k])).flatMap((k) => f(`classification.${k}`, "loosen"));
    }
    default:
      return f(key, "loosen");
  }
}

export function classifyChange(oldCfg: View, newCfg: View): Classification {
  const fields: FieldChange[] = [];
  for (const k of new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)])) fields.push(...classifyKey(k, oldCfg[k], newCfg[k]));
  const hasLoosen = fields.some((x) => x.direction === "loosen"), hasTighten = fields.some((x) => x.direction === "tighten");
  return { direction: hasLoosen && hasTighten ? "mixed" : hasLoosen ? "loosen" : hasTighten ? "tighten" : "neutral", fields };
}

/** The effective view of a profile: the tenant settings with the profile's override block applied (absent = inherit). */
export function profileView(base: View, cfg: unknown): View {
  const c = isRec(cfg) ? cfg : {};
  const baseClass = isRec(base.classification) ? base.classification : {};
  const baseBest = isRec(base.bestOf) ? base.bestOf : {};
  return {
    ...base, defaultDocType: null, linkDefaults: null, ...c,
    classification: { ...baseClass, ...(isRec(c.classification) ? c.classification : {}) },
    bestOf: { ...baseBest, ...(isRec(c.bestOf) ? c.bestOf : {}) },
  };
}

export type ChangeGroup =
  | "reviewThreshold" | "uncertainMargin" | "minScore" | "classification" | "malwareFailClosed" | "filingMakerChecker" | "providerChain"
  | "bestOf" | "pii" | "duplicatePolicy" | "allowedLinkTargets" | "retention" | "defaultDocType" | "other";

/** The form-hint group a classifier path belongs to. */
export function groupOf(path: string): ChangeGroup {
  if (path === "classification.uncertainMargin") return "uncertainMargin";
  if (path === "classification.minScore") return "minScore";
  if (path.startsWith("classification.")) return "classification";
  if (path.startsWith("bestOf.")) return "bestOf";
  if (path.startsWith("pii.")) return "pii";
  if (path === "retentionDaysByType" || path === "nonFiledRetentionDays") return "retention";
  const known: ChangeGroup[] = ["reviewThreshold", "malwareFailClosed", "filingMakerChecker", "providerChain", "duplicatePolicy", "allowedLinkTargets", "defaultDocType"];
  return (known as string[]).includes(path) ? (path as ChangeGroup) : "other";
}

export type ChangeDirections = Partial<Record<ChangeGroup, Exclude<Direction, "unchanged">>>;

/** Direction per hint group for what changed (a group is loosening if any of its fields loosens; neutral fields have no entry). */
export function changeDirections(before: View, after: View): ChangeDirections {
  const out: ChangeDirections = {};
  for (const x of classifyChange(before, after).fields) {
    if (x.direction === "neutral") continue;
    const g = groupOf(x.path);
    if (x.direction === "loosen") out[g] = "loosening";
    else if (out[g] === undefined) out[g] = "tightening";
  }
  return out;
}

/** The change needs approval as soon as one field loosens; otherwise it applies now (or there is nothing to apply). */
export function overallDirection(dirs: ChangeDirections): Direction {
  const all = Object.values(dirs);
  if (all.includes("loosening")) return "loosening";
  return all.includes("tightening") ? "tightening" : "unchanged";
}

/**
 * How the server will route the change: "approval" (loosening, super admin), "immediate" (tightening only), "request" (tenant
 * settings: tightening or neutral fields saved together with a neutral field become an ordinary change request), "none".
 */
export function routeOf(before: View, after: View, scope: "settings" | "profile"): "none" | "immediate" | "request" | "approval" {
  const c = classifyChange(before, after);
  if (c.direction === "loosen" || c.direction === "mixed") return "approval";
  if (c.fields.length === 0) return "none";
  if (scope === "profile") return "immediate";
  return c.direction === "tighten" && !c.fields.some((x) => x.direction === "neutral") ? "immediate" : "request";
}

/** `requiresApproval` from a 202 answer to a settings / profile write: true = a change request (second approver), false = applied, null = not stated. */
export function requiresApprovalOf(json: unknown): boolean | null {
  const root = isRec(json) ? json : null;
  const inner = isRec(root?.data) ? root.data : null;
  const v = root?.requiresApproval ?? inner?.requiresApproval;
  return typeof v === "boolean" ? v : null;
}
