import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSampleCalculation,
  computeFlatFeeLocal,
  computeSlabFeeLocal,
  emptyFeeDesign,
  exemptionsUiToApi,
  persistFeeDesign,
  rupeesInputToPaise,
} from "./feeBuilderApi";
import type { FeeExemptionUi, SlabRowUi } from "@/app/_components/ds/designer/feeTypes";

describe("feeBuilderApi", () => {
  it("converts rupees input to paise safely", () => {
    expect(rupeesInputToPaise("500")).toBe(50000);
    expect(rupeesInputToPaise("500.50")).toBe(50050);
    expect(rupeesInputToPaise("")).toBe(0);
  });

  it("maps exemptions to API shape", () => {
    const exemptions: FeeExemptionUi[] = [
      { id: "e1", attribute: "category", op: "eq", value: "micro", kind: "percent", amount: "50", label: "Micro enterprise" },
    ];
    const api = exemptionsUiToApi(exemptions);
    expect(api[0]?.kind).toBe("percent");
    expect(api[0]?.amount).toBe(50);
  });

  it("computes flat fee with 50% exemption", () => {
    const exemptions: FeeExemptionUi[] = [
      { id: "e1", attribute: "category", op: "eq", value: "micro", kind: "percent", amount: "50", label: "Micro" },
    ];
    const full = computeFlatFeeLocal(50000, exemptions, { category: "other" });
    expect(full.amount).toBe(50000);
    const half = computeFlatFeeLocal(50000, exemptions, { category: "micro" });
    expect(half.amount).toBe(25000);
    expect(half.exemptionLabel).toBe("Micro");
  });

  it("computes slab flat rate", () => {
    const slabs: SlabRowUi[] = [
      { id: "s1", from: "", to: "", rate: "75000", type: "flat" },
    ];
    expect(computeSlabFeeLocal(slabs, 999)).toBe(75000);
  });

  it("computes ad-valorem slab", () => {
    const slabs: SlabRowUi[] = [
      { id: "s1", from: "", to: "", rate: "500", type: "ad_valorem" },
    ];
    expect(computeSlabFeeLocal(slabs, 100000)).toBe(5000);
  });

  it("previews flat ₹500 with 50% micro exemption as demand lines", () => {
    const design = {
      ...emptyFeeDesign("Trade License"),
      feeModel: "flat" as const,
      baseAmountPaise: 50000,
      hoaCode: "0070",
      exemptions: [
        { id: "e1", attribute: "category", op: "eq" as const, value: "micro", kind: "percent" as const, amount: "50", label: "Micro enterprise" },
      ],
    };
    const calc = buildSampleCalculation(design, { category: "micro" }, 0, "on_time");
    expect(calc.lines[0]?.taxHeadCode).toBe("BASE");
    expect(calc.lines[0]?.amountPaise).toBe(50000);
    expect(calc.lines.some((l) => l.kind === "exemption" && l.amountPaise === -25000)).toBe(true);
    expect(calc.totalPaise).toBe(25000);
    expect(calc.hoaCode).toBe("0070");
  });

  it("applies early rebate and late penalty on sample rail", () => {
    const design = {
      ...emptyFeeDesign("Fee"),
      feeModel: "flat" as const,
      baseAmountPaise: 10000,
      hoaCode: "0029",
      rebateDays: 7,
      rebatePercent: 10,
      penaltyDays: 15,
      penaltyPercent: 5,
    };
    const early = buildSampleCalculation(design, {}, 0, "early");
    expect(early.totalPaise).toBe(9000);
    expect(early.lines.some((l) => l.kind === "rebate")).toBe(true);

    const late = buildSampleCalculation(design, {}, 0, "late");
    expect(late.totalPaise).toBe(10500);
    expect(late.lines.some((l) => l.kind === "penalty")).toBe(true);
  });
});

/**
 * UX-016: persistFeeDesign's parseJson used to throw the raw response body
 * text (or a `Request failed (${status})` fallback) on a failed fee-schedule
 * save — the same class of leak useFormError closes for components
 * (UX-003). This module is a plain async data client, not a component, so
 * it can't use that hook; it now goes through the same catalogued
 * toHumanError vocabulary instead and never reads the response body at
 * all, so it structurally cannot leak it.
 */
describe("feeBuilderApi — persistFeeDesign never leaks raw status or server text", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("throws a clerk-safe message, never the raw HTTP status or server text, when saving a flat fee schedule fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "revenue-service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const design = { ...emptyFeeDesign("Trade License"), feeModel: "flat" as const };
    const err = await persistFeeDesign(design, "svc-1", "Trade License").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).not.toContain("revenue-service unavailable");
    expect(message).toMatch(/couldn't save/i);
  });
});

/**
 * GAP-DESIGNER-DETAIL-B5-02: string-based rupees parser. Rejects invalid input
 * with an error instead of silently coercing to 0 (which would create a ₹0 fee
 * demand for citizens). Uses integer arithmetic only — no float rounding.
 */
import { parseRupeesToPaise } from "./feeBuilderApi";

describe("parseRupeesToPaise (GAP-DESIGNER-DETAIL-B5-02)", () => {
  it("parses whole rupees correctly", () => {
    const r = parseRupeesToPaise("10");
    expect(r).toEqual({ ok: true, paise: 1000 });
  });

  it("parses rupees with one decimal", () => {
    const r = parseRupeesToPaise("10.5");
    expect(r).toEqual({ ok: true, paise: 1050 });
  });

  it("parses rupees with two decimals", () => {
    const r = parseRupeesToPaise("10.50");
    expect(r).toEqual({ ok: true, paise: 1050 });
  });

  it("rejects more than 2 decimal places (1.005 would float-round wrong)", () => {
    const r = parseRupeesToPaise("1.005");
    expect(r.ok).toBe(false);
  });

  it("rejects negative values", () => {
    const r = parseRupeesToPaise("-5");
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric text", () => {
    const r = parseRupeesToPaise("abc");
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = parseRupeesToPaise("");
    expect(r.ok).toBe(false);
  });

  it("handles large values without losing precision", () => {
    const r = parseRupeesToPaise("99999999999.99");
    expect(r).toEqual({ ok: true, paise: 9999999999999 });
  });

  it("rejects zero as valid (₹0 is a valid amount)", () => {
    const r = parseRupeesToPaise("0");
    expect(r).toEqual({ ok: true, paise: 0 });
  });
});


describe("CLOS3-S1-11 persistFeeDesign edit semantics", () => {
  type Call = { url: string; method: string; body?: unknown };
  let calls: Call[];

  function stub(opts: { failSlabPut?: boolean } = {}) {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/revenue/rate-heads") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "head-1" }] }) } as Response;
      }
      if (url.endsWith("/revenue/rate-heads")) {
        return { ok: true, status: 202, json: async () => ({ data: { id: "head-1" } }) } as Response;
      }
      if (url.includes("/slabs") && opts.failSlabPut) return { ok: false, status: 500, json: async () => ({}) } as Response;
      if (url.includes("/citizen/fees/schedules/")) {
        return { ok: true, status: 202, json: async () => ({ id: "sched-2" }) } as Response;
      }
      return { ok: true, status: 202, json: async () => ({ id: "sched-1" }) } as Response;
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  const flat = { ...emptyFeeDesign("T"), feeModel: "flat" as const, baseAmountPaise: 5000 };

  it("a saved flat fee is PATCHed (bigint paise body), never POSTed again; successor id is kept", async () => {
    stub();
    const saved = await persistFeeDesign({ ...flat, scheduleId: "sched-1" }, "svc-1", "T");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PATCH /api/proxy/v1/citizen/fees/schedules/sched-1"]);
    expect(calls[0]!.body).toMatchObject({ baseAmount: 5000, currency: "INR" });
    expect(calls[0]!.body).not.toHaveProperty("serviceId");
    expect(saved.scheduleId).toBe("sched-2");
  });

  it("a new flat fee is POSTed once with its serviceId", async () => {
    stub();
    const saved = await persistFeeDesign(flat, "svc-1", "T");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/proxy/v1/citizen/fees/schedules" });
    expect(calls[0]!.body).toMatchObject({ serviceId: "svc-1" });
    expect(saved.scheduleId).toBe("sched-1");
  });

  const slabDesign = {
    ...emptyFeeDesign("T"),
    feeModel: "slab" as const,
    slabs: [
      { id: "a", type: "band" as const, from: "0", to: "1000", rate: "10" },
      { id: "b", type: "band" as const, from: "1000", to: "", rate: "20" },
    ],
  };

  it("slabs are written as ONE atomic PUT (not N POSTs) against the head", async () => {
    stub();
    const saved = await persistFeeDesign(slabDesign, "svc-1", "T");
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe("/api/proxy/v1/revenue/rate-heads/head-1/slabs");
    expect((puts[0]!.body as { slabs: unknown[] }).slabs).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes("/rate-slabs"))).toHaveLength(0);
    expect(saved.rateHeadId).toBe("head-1");
  });

  it("an existing head is reused; a retry after a failed slab write does not create another head", async () => {
    stub({ failSlabPut: true });
    await expect(persistFeeDesign(slabDesign, "svc-retry", "T")).rejects.toThrow();
    stub();
    await persistFeeDesign(slabDesign, "svc-retry", "T");
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/revenue/rate-heads"))).toHaveLength(0);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    stub();
    await persistFeeDesign({ ...slabDesign, rateHeadId: "head-9" }, "svc-2", "T");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(calls.find((c) => c.method === "PUT")!.url).toContain("/rate-heads/head-9/slabs");
  });
});
