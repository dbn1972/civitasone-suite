import { describe, it, expect, vi, afterEach } from "vitest";
import { aggregateFunnel, FUNNEL_STEPS, trackActivation, type ActivationEvent } from "./activation";

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

describe("trackActivation (CLOS3-S3-21)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "sendBeacon");
  });

  it("swallows a network failure of the fetch fallback (no unhandled rejection)", async () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    // A plain function, not vi.fn(): the spy wrapper attaches its own handler to a returned promise and would
    // mask the unhandled rejection this test is looking for.
    const calls: Array<[string, RequestInit]> = [];
    const fetchMock = (url: string, init: RequestInit): Promise<Response> => {
      calls.push([url, init]);
      return Promise.reject(new Error("net"));
    };
    vi.stubGlobal("fetch", fetchMock);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      trackActivation("signin");
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toHaveLength(1);
      expect(calls[0]![1].keepalive).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("uses sendBeacon when available and does not call fetch", () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    trackActivation("signin");
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
