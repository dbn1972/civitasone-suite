import { describe, it, expect } from "vitest";
import { aggregateFunnel, FUNNEL_STEPS, type ActivationEvent } from "./activation";

const t0 = "2026-06-27T10:00:00.000Z";
const min = (n: number) => new Date(Date.parse(t0) + n * 60000).toISOString();

describe("activation funnel aggregation (north star: TTFRT)", () => {
  it("counts distinct offices reaching each step and computes drop-off", () => {
    const events: ActivationEvent[] = [
      { tenantId: "A", step: "signin", at: t0 },
      { tenantId: "A", step: "wizard_opened", at: min(1) },
      { tenantId: "A", step: "org-profile", at: min(2) },
      { tenantId: "B", step: "signin", at: t0 },
      { tenantId: "B", step: "wizard_opened", at: min(1) },
      // B drops off before org-profile
    ];
    const agg = aggregateFunnel(events);
    expect(agg.totalOffices).toBe(2);
    const byStep = Object.fromEntries(agg.stages.map((s) => [s.step, s]));
    expect(byStep["signin"].reached).toBe(2);
    expect(byStep["wizard_opened"].reached).toBe(2);
    expect(byStep["org-profile"].reached).toBe(1);
    expect(byStep["org-profile"].droppedFromPrev).toBe(1);
    expect(byStep["wizard_opened"].retention).toBe(1);
    expect(byStep["org-profile"].retention).toBe(0.5);
  });

  it("computes median TTFRT only from offices that signed in AND transacted", () => {
    const events: ActivationEvent[] = [
      { tenantId: "A", step: "signin", at: t0 },
      { tenantId: "A", step: "first_transaction", at: min(20) },
      { tenantId: "B", step: "signin", at: t0 },
      { tenantId: "B", step: "first_transaction", at: min(40) },
      { tenantId: "C", step: "signin", at: t0 }, // never transacts
    ];
    const agg = aggregateFunnel(events);
    expect(agg.ttfrtMedianMinutes).toBe(30); // median of [20, 40]
    expect(agg.activatedOffices).toBe(2);
    expect(agg.activationRate).toBeCloseTo(2 / 3);
  });

  it("uses the earliest timestamp per step (idempotent re-emits don't skew TTFRT)", () => {
    const events: ActivationEvent[] = [
      { tenantId: "A", step: "signin", at: min(5) },
      { tenantId: "A", step: "signin", at: t0 }, // earlier re-emit
      { tenantId: "A", step: "first_transaction", at: min(15) },
    ];
    expect(aggregateFunnel(events).ttfrtMedianMinutes).toBe(15);
  });

  it("returns null TTFRT and zero activation when nobody has transacted", () => {
    const agg = aggregateFunnel([{ tenantId: "A", step: "signin", at: t0 }]);
    expect(agg.ttfrtMedianMinutes).toBeNull();
    expect(agg.activationRate).toBe(0);
  });

  it("exposes all golden-path steps in order", () => {
    expect(FUNNEL_STEPS[0]).toBe("signin");
    expect(FUNNEL_STEPS[FUNNEL_STEPS.length - 1]).toBe("first_transaction");
  });
});
