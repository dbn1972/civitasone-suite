/**
 * Activation funnel — the instrumentation behind our north star,
 * Time-to-First-Real-Transaction (TTFRT).
 *
 * We record when an office reaches each step of the golden path, then compute
 * how long it takes to reach the first real transaction and where offices drop
 * off. This file holds the event model and the PURE aggregation functions (no
 * browser/server deps) so the maths is unit-testable. The client emitter and the
 * ingestion route live alongside but are kept side-effect-light.
 */

/** Ordered golden-path milestones. Order matters for drop-off computation. */
export const FUNNEL_STEPS = [
  "signin",
  "wizard_opened",
  "org-profile",
  "branches",
  "departments",
  "people",
  "modules",
  "first_transaction",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export type ActivationEvent = {
  /** Per-office identifier (the tenant), set server-side from the session. */
  tenantId: string;
  step: FunnelStep;
  /** ISO timestamp. */
  at: string;
};

export type FunnelStage = {
  step: FunnelStep;
  /** Distinct offices that reached this step. */
  reached: number;
  /** Offices lost since the previous step. */
  droppedFromPrev: number;
  /** Share of offices retained from the previous step (0–1); 1 for the first step. */
  retention: number;
};

export type ActivationAggregate = {
  totalOffices: number;
  stages: FunnelStage[];
  /** Median minutes from first sign-in to first real transaction. null if none yet. */
  ttfrtMedianMinutes: number | null;
  /** Offices that reached first_transaction. */
  activatedOffices: number;
  /** Activation rate = activated / offices that signed in (0–1). */
  activationRate: number;
};

/** Earliest timestamp per (tenant, step). */
function earliestByTenantStep(events: ActivationEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) {
    const key = `${e.tenantId}::${e.step}`;
    const prev = m.get(key);
    if (!prev || e.at < prev) m.set(key, e.at);
  }
  return m;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Build the funnel + TTFRT from raw events. Pure and deterministic. */
export function aggregateFunnel(events: ActivationEvent[]): ActivationAggregate {
  const tenants = new Set(events.map((e) => e.tenantId));
  const earliest = earliestByTenantStep(events);

  const reachedByStep = new Map<FunnelStep, Set<string>>();
  for (const step of FUNNEL_STEPS) reachedByStep.set(step, new Set());
  for (const e of events) reachedByStep.get(e.step)?.add(e.tenantId);

  const stages: FunnelStage[] = FUNNEL_STEPS.map((step, i) => {
    const reached = reachedByStep.get(step)!.size;
    const prevReached = i === 0 ? reached : reachedByStep.get(FUNNEL_STEPS[i - 1])!.size;
    const droppedFromPrev = i === 0 ? 0 : Math.max(0, prevReached - reached);
    const retention = i === 0 ? 1 : prevReached === 0 ? 0 : reached / prevReached;
    return { step, reached, droppedFromPrev, retention };
  });

  // TTFRT: minutes between signin and first_transaction, per tenant that did both.
  const ttfrtMinutes: number[] = [];
  for (const tenantId of tenants) {
    const signin = earliest.get(`${tenantId}::signin`);
    const first = earliest.get(`${tenantId}::first_transaction`);
    if (signin && first) {
      const mins = (new Date(first).getTime() - new Date(signin).getTime()) / 60000;
      if (mins >= 0) ttfrtMinutes.push(mins);
    }
  }

  const signedIn = reachedByStep.get("signin")!.size;
  const activatedOffices = reachedByStep.get("first_transaction")!.size;

  return {
    totalOffices: tenants.size,
    stages,
    ttfrtMedianMinutes: median(ttfrtMinutes),
    activatedOffices,
    activationRate: signedIn === 0 ? 0 : activatedOffices / signedIn,
  };
}

/**
 * Client-side emitter: send a funnel event via a fire-and-forget beacon. Safe to
 * call from the browser only; no-ops on the server. The tenant id is attached
 * server-side from the session, so we never trust a client-supplied tenant.
 */
export function trackActivation(step: FunnelStep): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ step });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/activation", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/activation", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
    }
  } catch {
    /* never let instrumentation break the UI */
  }
}
