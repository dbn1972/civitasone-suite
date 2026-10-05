/** Scan-profile form state <-> API body. A profile only stores the settings it OVERRIDES; absent = use the tenant setting. */
import type { ChainEntry } from "./settingsSchema";

export interface ProfileFormState {
  name: string;
  description: string;
  languages?: string[];
  dpi?: number;
  preprocessingSteps?: string[];
  reviewThreshold?: number;
  bestOf?: { enabled: boolean; threshold: number };
  providerChain?: ChainEntry[];
  defaultDocType?: string;
  linkTarget?: string;
  uncertainMargin?: number;
  minScore?: number;
}

export const EMPTY_PROFILE: ProfileFormState = { name: "", description: "" };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

export function profileToForm(p: { name: string; description: string | null; config: Rec }): ProfileFormState {
  const c = p.config;
  const out: ProfileFormState = { name: p.name, description: p.description ?? "" };
  const languages = strs(c.languages);
  if (languages) out.languages = languages;
  if (typeof c.dpi === "number") out.dpi = c.dpi;
  const steps = strs(c.preprocessingSteps);
  if (steps) out.preprocessingSteps = steps;
  if (typeof c.reviewThreshold === "number") out.reviewThreshold = c.reviewThreshold;
  const b = rec(c.bestOf);
  if (b && typeof b.enabled === "boolean" && typeof b.threshold === "number") out.bestOf = { enabled: b.enabled, threshold: b.threshold };
  if (Array.isArray(c.providerChain)) {
    out.providerChain = c.providerChain.flatMap((x) => { const r = rec(x); return r && typeof r.id === "string" ? [{ id: r.id, timeoutMs: typeof r.timeoutMs === "number" ? r.timeoutMs : 120_000 }] : []; });
  }
  if (typeof c.defaultDocType === "string") out.defaultDocType = c.defaultDocType;
  const ld = rec(c.linkDefaults);
  if (ld && typeof ld.target === "string") out.linkTarget = ld.target;
  const cl = rec(c.classification);
  if (cl && typeof cl.uncertainMargin === "number") out.uncertainMargin = cl.uncertainMargin;
  if (cl && typeof cl.minScore === "number") out.minScore = cl.minScore;
  return out;
}

export function formToConfig(f: ProfileFormState): Rec {
  const config: Rec = {};
  if (f.languages) config.languages = f.languages;
  if (f.dpi !== undefined) config.dpi = f.dpi;
  if (f.preprocessingSteps) config.preprocessingSteps = f.preprocessingSteps;
  if (f.reviewThreshold !== undefined) config.reviewThreshold = f.reviewThreshold;
  if (f.bestOf) config.bestOf = f.bestOf;
  if (f.providerChain) config.providerChain = f.providerChain;
  if (f.defaultDocType) config.defaultDocType = f.defaultDocType;
  if (f.linkTarget) config.linkDefaults = { target: f.linkTarget };
  if (f.uncertainMargin !== undefined || f.minScore !== undefined) {
    config.classification = { ...(f.uncertainMargin !== undefined ? { uncertainMargin: f.uncertainMargin } : {}), ...(f.minScore !== undefined ? { minScore: f.minScore } : {}) };
  }
  return config;
}

export function formToBody(f: ProfileFormState): { name: string; description?: string; config: Rec } {
  const description = f.description.trim();
  return { name: f.name.trim(), ...(description ? { description } : {}), config: formToConfig(f) };
}

/** A short human summary of what a profile overrides (i18n keys + values are assembled by the caller). */
export function overrideKeys(config: Rec): string[] {
  return Object.keys(config).filter((k) => config[k] !== undefined);
}
