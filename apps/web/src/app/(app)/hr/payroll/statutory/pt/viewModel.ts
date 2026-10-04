/**
 * GAP-PAYROLL-STATUTORY-PT-04: view model for the professional-tax page.
 * Pure: turns GET /v1/payroll/statutory/pt/versions into what the page needs
 * (selected state, its timeline, the selected / current version) so the page
 * itself holds no list-emptiness logic.
 */
import { PT_NO_UPPER_BOUND_MINOR } from "./constants";

export type PtApiSlab = { fromMinor: number; toMinor: number; taxMinor: number; februaryTaxMinor: number | null };
export type PtVersionStatus = "past" | "current" | "upcoming";
export type PtApiVersion = {
  stateCode: string; effectiveFrom: string; effectiveTo: string | null; status: PtVersionStatus;
  legacy: boolean; reason: string | null; backDated: boolean; createdAt: string | null; slabs: PtApiSlab[];
};
export type PtPendingRequest = {
  id: string; kind: "version" | "checker_off"; stateCode: string | null; effectiveFrom: string | null;
  slabs: PtApiSlab[]; reason: string | null; makerId: string; createdAt: string;
};
export type PtVersionsPayload = {
  today: string;
  /** The signed-in user (to tell their own requests, which they cannot approve, from others'). */
  viewerId: string;
  /** maker != checker for PT changes (tenant switch, default ON). */
  makerChecker: boolean;
  pending: PtPendingRequest[];
  lastFinalisedMonth: string | null;
  earliestEffectiveFrom: string | null;
  states: Array<{ stateCode: string; versions: PtApiVersion[] }>;
};

export const EMPTY_PT_PAYLOAD: PtVersionsPayload = { today: "", viewerId: "", makerChecker: true, pending: [], lastFinalisedMonth: null, earliestEffectiveFrom: null, states: [] };

const STATUSES: ReadonlySet<string> = new Set(["past", "current", "upcoming"]);

/** Defensive parse of the API payload; null (a load error) when it is not the expected shape. */
export function parsePtPayload(p: unknown): PtVersionsPayload | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  if (typeof r.today !== "string" || !Array.isArray(r.states)) return null;
  const states: PtVersionsPayload["states"] = [];
  for (const s of r.states as unknown[]) {
    const st = s as { stateCode?: unknown; versions?: unknown };
    if (typeof st?.stateCode !== "string" || !Array.isArray(st.versions)) return null;
    const versions: PtApiVersion[] = [];
    for (const v of st.versions as unknown[]) {
      const x = v as Partial<PtApiVersion>;
      if (typeof x.effectiveFrom !== "string" || !STATUSES.has(String(x.status)) || !Array.isArray(x.slabs)) return null;
      versions.push({
        stateCode: st.stateCode, effectiveFrom: x.effectiveFrom, effectiveTo: x.effectiveTo ?? null, status: x.status as PtVersionStatus,
        legacy: x.legacy === true, reason: x.reason ?? null, backDated: x.backDated === true, createdAt: x.createdAt ?? null,
        slabs: x.slabs.map((sl) => ({
          fromMinor: Number(sl.fromMinor), toMinor: Number(sl.toMinor), taxMinor: Number(sl.taxMinor),
          februaryTaxMinor: sl.februaryTaxMinor == null ? null : Number(sl.februaryTaxMinor),
        })),
      });
    }
    states.push({ stateCode: st.stateCode, versions });
  }
  const pending: PtPendingRequest[] = [];
  for (const x of Array.isArray(r.pending) ? (r.pending as unknown[]) : []) {
    const q = x as Partial<PtPendingRequest>;
    if (typeof q.id !== "string" || (q.kind !== "version" && q.kind !== "checker_off") || typeof q.makerId !== "string") return null;
    pending.push({
      id: q.id, kind: q.kind, stateCode: q.stateCode ?? null, effectiveFrom: q.effectiveFrom ?? null,
      slabs: (q.slabs ?? []).map((sl) => ({
        fromMinor: Number(sl.fromMinor), toMinor: Number(sl.toMinor), taxMinor: Number(sl.taxMinor),
        februaryTaxMinor: sl.februaryTaxMinor == null ? null : Number(sl.februaryTaxMinor),
      })),
      reason: q.reason ?? null, makerId: q.makerId, createdAt: String(q.createdAt ?? ""),
    });
  }
  return {
    today: r.today,
    viewerId: typeof r.viewerId === "string" ? r.viewerId : "",
    makerChecker: r.makerChecker !== false,
    pending,
    lastFinalisedMonth: typeof r.lastFinalisedMonth === "string" ? r.lastFinalisedMonth : null,
    earliestEffectiveFrom: typeof r.earliestEffectiveFrom === "string" ? r.earliestEffectiveFrom : null,
    states,
  };
}

export type PtView = {
  /** State codes that already have at least one version. */
  configuredStates: string[];
  hasConfiguredStates: boolean;
  stateCode: string | null;
  /** Timeline of the selected state, newest first. */
  versions: PtApiVersion[];
  hasVersions: boolean;
  /** The version in force today (null when none is). */
  current: PtApiVersion | null;
  /** The version being viewed: ?version=, else the current one, else the newest. */
  selected: PtApiVersion | null;
  /** The slabs the "new version" form starts from (current, else newest). */
  baseSlabs: PtApiSlab[];
  /** Requests waiting for a different administrator: this state's versions plus the tenant-wide "turn the switch off" request. */
  pending: PtPendingRequest[];
  hasPending: boolean;
};

export function buildPtView(payload: PtVersionsPayload, stateParam: string | undefined, versionParam: string | undefined): PtView {
  const configuredStates = payload.states.map((s) => s.stateCode).sort();
  const wanted = (stateParam ?? "").trim().toUpperCase();
  const stateCode = wanted || null;
  const chosen = stateCode ? payload.states.find((s) => s.stateCode === stateCode) : undefined;
  const versions = [...(chosen?.versions ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const current = versions.find((v) => v.status === "current") ?? null;
  const selected = versions.find((v) => v.effectiveFrom === versionParam) ?? current ?? versions[0] ?? null;
  const base = current ?? versions[0] ?? null;
  const scoped = payload.pending.filter((x) => x.kind === "checker_off" || x.stateCode === stateCode);
  return {
    configuredStates, hasConfiguredStates: configuredStates.some(Boolean),
    stateCode, versions, hasVersions: versions.some(Boolean), current, selected,
    baseSlabs: base ? base.slabs : [],
    pending: scoped, hasPending: scoped.some(Boolean),
  };
}

/** "No upper bound" sentinel check for a slab's To value. */
export const isOpenEnded = (toMinor: number | null | undefined): boolean => toMinor == null || Number(toMinor) >= PT_NO_UPPER_BOUND_MINOR;
