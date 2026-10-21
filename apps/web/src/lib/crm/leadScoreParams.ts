/**
 * GAP-CRM-LEAD-SCORING-02 -- structured model for a score function's `params`.
 *
 * The scoring rules editor used to hand admins a raw JSON box. This module is the
 * form model behind the structured editor: a string-valued draft per function kind
 * (so a half-typed number never crashes state), per-FIELD validation that mirrors
 * exactly what crm-service reads (leads/score-rules-domain.ts buildScoreFn), and the
 * conversion both ways (draft <-> params object) plus a validator for the "Advanced
 * JSON" fallback.
 *
 * What buildScoreFn reads, per kind:
 *   presence          { present, absent }
 *   map               { values: { <lower-case value>: score }, default }
 *   recency           { tiers: [{ maxDays, score }], beyondScore, absentScore }
 *   numeric_threshold { tiers: [{ min, score }], default }
 * Every score is clamped to 0-100 by the scorer, so an out-of-range score is rejected
 * here rather than silently clamped. Map keys are matched against the LOWER-CASED lead
 * value, so a key with upper-case letters could never match and is rejected too.
 */
import type { ScoreFnType } from "./leadQualification";

/** One tier row in a draft: `bound` is `maxDays` (recency) or `min` (numeric_threshold). */
export interface TierDraft {
  bound: string;
  score: string;
}
export interface MapRowDraft {
  key: string;
  score: string;
}

export interface ParamsDraft {
  present: string;
  absent: string;
  /** `default` -- used by map and numeric_threshold. */
  defaultScore: string;
  beyondScore: string;
  absentScore: string;
  mapRows: MapRowDraft[];
  tiers: TierDraft[];
  /** Keys the form does not model are carried through untouched, never dropped. */
  extra: Record<string, unknown>;
}

export function emptyDraft(): ParamsDraft {
  return { present: "", absent: "", defaultScore: "", beyondScore: "", absentScore: "", mapRows: [], tiers: [], extra: {} };
}

export type ParamIssueCode =
  | "notNumber"
  | "scoreRange"
  | "daysRange"
  | "keyBlank"
  | "keyCase"
  | "keyDuplicate"
  | "valuesNotObject"
  | "valueNotNumber"
  | "tiersNotArray"
  | "tierShape";

/**
 * `field` names the offending input in the structured form
 * (`present`, `absent`, `defaultScore`, `beyondScore`, `absentScore`,
 * `mapKey.<i>`, `mapScore.<i>`, `tierBound.<i>`, `tierScore.<i>`) or, for the JSON
 * validator, the offending params key (`present`, `values`, `values.<key>`, `tiers`,
 * `tiers.<i>`, `default`, `beyondScore`, `absentScore`).
 */
export interface ParamIssue {
  field: string;
  code: ParamIssueCode;
}

const KNOWN_KEYS: Record<ScoreFnType, readonly string[]> = {
  presence: ["present", "absent"],
  map: ["values", "default"],
  recency: ["tiers", "beyondScore", "absentScore"],
  numeric_threshold: ["tiers", "default"],
};

/** The tier bound key per kind. */
export function tierBoundKey(type: ScoreFnType): "maxDays" | "min" {
  return type === "recency" ? "maxDays" : "min";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
/** A blank string is "not set" (the scorer's default applies); anything else must parse as a finite number. */
function parseNum(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function inScoreRange(n: number): boolean {
  return n >= 0 && n <= 100;
}

/* ------------------------------------------------------------- draft -> params === */

/** Validate a draft field-by-field (the structured form). Blank optional fields are fine. */
export function draftIssues(type: ScoreFnType, d: ParamsDraft): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const score = (field: string, raw: string, required: boolean) => {
    const n = parseNum(raw);
    if (n === undefined) {
      if (required) issues.push({ field, code: "notNumber" });
    } else if (n === null) issues.push({ field, code: "notNumber" });
    else if (!inScoreRange(n)) issues.push({ field, code: "scoreRange" });
  };
  switch (type) {
    case "presence":
      score("present", d.present, false);
      score("absent", d.absent, false);
      break;
    case "map": {
      const seen = new Set<string>();
      d.mapRows.forEach((r, i) => {
        const key = r.key.trim();
        if (key === "") issues.push({ field: `mapKey.${i}`, code: "keyBlank" });
        else if (key !== key.toLowerCase()) issues.push({ field: `mapKey.${i}`, code: "keyCase" });
        else if (seen.has(key)) issues.push({ field: `mapKey.${i}`, code: "keyDuplicate" });
        else seen.add(key);
        score(`mapScore.${i}`, r.score, true);
      });
      score("defaultScore", d.defaultScore, false);
      break;
    }
    case "recency":
    case "numeric_threshold": {
      d.tiers.forEach((t, i) => {
        const b = parseNum(t.bound);
        if (b === undefined || b === null) issues.push({ field: `tierBound.${i}`, code: "notNumber" });
        else if (type === "recency" && b < 0) issues.push({ field: `tierBound.${i}`, code: "daysRange" });
        score(`tierScore.${i}`, t.score, true);
      });
      score("defaultScore", d.defaultScore, false);
      if (type === "recency") {
        score("beyondScore", d.beyondScore, false);
        score("absentScore", d.absentScore, false);
      }
      break;
    }
  }
  return issues;
}

/** Build the params object from a draft. Only meaningful when draftIssues() is empty. */
export function paramsFromDraft(type: ScoreFnType, d: ParamsDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d.extra };
  const put = (key: string, raw: string) => {
    const n = parseNum(raw);
    if (typeof n === "number") out[key] = n;
  };
  switch (type) {
    case "presence":
      put("present", d.present);
      put("absent", d.absent);
      break;
    case "map": {
      const values: Record<string, number> = {};
      for (const r of d.mapRows) {
        const n = parseNum(r.score);
        if (r.key.trim() !== "" && typeof n === "number") values[r.key.trim()] = n;
      }
      if (Object.keys(values).length > 0) out.values = values;
      put("default", d.defaultScore);
      break;
    }
    case "recency":
    case "numeric_threshold": {
      const bound = tierBoundKey(type);
      const tiers: Array<Record<string, number>> = [];
      for (const t of d.tiers) {
        const b = parseNum(t.bound);
        const s = parseNum(t.score);
        if (typeof b === "number" && typeof s === "number") tiers.push({ [bound]: b, score: s });
      }
      if (tiers.length > 0) out.tiers = tiers;
      put("default", d.defaultScore);
      if (type === "recency") {
        put("beyondScore", d.beyondScore);
        put("absentScore", d.absentScore);
      }
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------- params -> draft === */

const numStr = (v: unknown): string => (isNum(v) ? String(v) : "");

/**
 * Turn a stored params object into a form draft, or null when it cannot be shown in the
 * form without losing information (wrong shapes, non-numbers) -- the editor then keeps
 * that rule in Advanced JSON mode so nothing is silently rewritten.
 */
export function draftFromParams(type: ScoreFnType, params: Record<string, unknown>): ParamsDraft | null {
  const d = emptyDraft();
  const known = new Set(KNOWN_KEYS[type]);
  for (const [k, v] of Object.entries(params)) if (!known.has(k)) d.extra[k] = v;
  switch (type) {
    case "presence":
      if ((params.present !== undefined && !isNum(params.present)) || (params.absent !== undefined && !isNum(params.absent))) return null;
      d.present = numStr(params.present);
      d.absent = numStr(params.absent);
      return d;
    case "map": {
      if (params.values !== undefined) {
        if (!isObject(params.values)) return null;
        for (const [k, v] of Object.entries(params.values)) {
          if (!isNum(v)) return null;
          d.mapRows.push({ key: k, score: String(v) });
        }
      }
      if (params.default !== undefined && !isNum(params.default)) return null;
      d.defaultScore = numStr(params.default);
      return d;
    }
    case "recency":
    case "numeric_threshold": {
      const bound = tierBoundKey(type);
      if (params.tiers !== undefined) {
        if (!Array.isArray(params.tiers)) return null;
        for (const t of params.tiers) {
          if (!isObject(t)) return null;
          const b = t[bound];
          const s = t.score;
          if (!isNum(b) || !isNum(s)) return null;
          d.tiers.push({ bound: String(b), score: String(s) });
        }
      }
      if (params.default !== undefined && !isNum(params.default)) return null;
      d.defaultScore = numStr(params.default);
      if (type === "recency") {
        if ((params.beyondScore !== undefined && !isNum(params.beyondScore)) || (params.absentScore !== undefined && !isNum(params.absentScore))) return null;
        d.beyondScore = numStr(params.beyondScore);
        d.absentScore = numStr(params.absentScore);
      }
      return d;
    }
  }
}

/* ------------------------------------------------------- Advanced JSON validator === */

/**
 * Validate a parsed params object for the Advanced JSON fallback, against the same
 * contract the structured form enforces (shape first, then score range / lower-case
 * keys). `field` is the params key, so the editor can name it in the message.
 */
export function paramsIssues(type: ScoreFnType, params: Record<string, unknown>): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const score = (field: string, v: unknown) => {
    if (v === undefined) return;
    if (!isNum(v)) issues.push({ field, code: "notNumber" });
    else if (!inScoreRange(v)) issues.push({ field, code: "scoreRange" });
  };
  switch (type) {
    case "presence":
      score("present", params.present);
      score("absent", params.absent);
      break;
    case "map":
      if (params.values !== undefined) {
        if (!isObject(params.values)) issues.push({ field: "values", code: "valuesNotObject" });
        else {
          for (const [k, v] of Object.entries(params.values)) {
            if (!isNum(v)) issues.push({ field: `values.${k}`, code: "valueNotNumber" });
            else if (!inScoreRange(v)) issues.push({ field: `values.${k}`, code: "scoreRange" });
            if (k !== k.toLowerCase()) issues.push({ field: `values.${k}`, code: "keyCase" });
          }
        }
      }
      score("default", params.default);
      break;
    case "recency":
    case "numeric_threshold": {
      const bound = tierBoundKey(type);
      if (params.tiers !== undefined) {
        if (!Array.isArray(params.tiers)) issues.push({ field: "tiers", code: "tiersNotArray" });
        else {
          params.tiers.forEach((t, i) => {
            const b = isObject(t) ? t[bound] : undefined;
            const s = isObject(t) ? t.score : undefined;
            if (!isNum(b) || !isNum(s)) issues.push({ field: `tiers.${i}`, code: "tierShape" });
            else {
              if (type === "recency" && b < 0) issues.push({ field: `tiers.${i}.${bound}`, code: "daysRange" });
              if (!inScoreRange(s)) issues.push({ field: `tiers.${i}.score`, code: "scoreRange" });
            }
          });
        }
      }
      score("default", params.default);
      if (type === "recency") {
        score("beyondScore", params.beyondScore);
        score("absentScore", params.absentScore);
      }
      break;
    }
  }
  return issues;
}
