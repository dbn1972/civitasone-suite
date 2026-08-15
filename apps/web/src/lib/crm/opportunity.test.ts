import { describe, it, expect } from "vitest";
import {
  normalisePipeline,
  normalisePipelines,
  normaliseStage,
  normaliseOpportunity,
  normaliseOpportunities,
  normaliseKanban,
  normaliseFunnel,
  normaliseAgeing,
  normaliseStageLimits,
  extractMissingFields,
  MandatoryFieldsError,
  OPP_FIELD_KEYS,
  CLOSE_OUTCOMES,
} from "./opportunity";

describe("opportunity normalisers (OP-001..006)", () => {
  it("normalises a pipeline with stages and filters unknown mandatory fields", () => {
    const p = normalisePipeline({
      id: "p1",
      name: "Enterprise",
      stages: [
        { key: "qual", name: "Qualify", mandatoryFields: ["value", "bogus", "product"], gate: true, region: "west" },
      ],
    });
    expect(p).not.toBeNull();
    expect(p!.stages).toHaveLength(1);
    expect(p!.stages[0].mandatoryFields).toEqual(["value", "product"]);
    expect(p!.stages[0].gate).toBe(true);
    expect(p!.stages[0].region).toBe("west");
  });

  it("derives a stage key from the name when absent", () => {
    const s = normaliseStage({ name: "Needs Analysis" });
    expect(s!.key).toBe("needs_analysis");
  });

  it("tolerates a wrapped { pipelines } payload", () => {
    expect(normalisePipelines({ pipelines: [{ name: "A" }, { name: "B" }] })).toHaveLength(2);
    expect(normalisePipelines([{ name: "A" }])).toHaveLength(1);
    expect(normalisePipelines(null)).toEqual([]);
  });

  it("normalises an opportunity, keeping money as a paise string (value or valueMinor)", () => {
    const o = normaliseOpportunity({
      id: "d1",
      name: "Deal",
      valueMinor: 150000,
      probability: 40,
      competitors: ["Acme", ""],
      quantity: 3,
    });
    expect(o!.valueMinor).toBe("150000");
    expect(o!.competitors).toEqual(["Acme"]);
    expect(normaliseOpportunity({ id: "d2", value: "25000" })!.valueMinor).toBe("25000");
  });

  it("normalises kanban columns and funnel rows", () => {
    const k = normaliseKanban({ columns: [{ stage: "qual", stageName: "Qualify", deals: [{ id: "d1", name: "x" }] }] });
    expect(k).toHaveLength(1);
    expect(k[0].deals).toHaveLength(1);
    const f = normaliseFunnel([{ stage: "qual", count: 5, valueMinor: "9900" }]);
    expect(f[0]).toMatchObject({ stage: "qual", count: 5, valueMinor: "9900" });
  });

  it("computes exceededBy for ageing rows when not provided", () => {
    const rows = normaliseAgeing([{ id: "d1", name: "x", stage: "qual", daysInStage: 20, limitDays: 14 }]);
    expect(rows[0].exceededBy).toBe(6);
    const rows2 = normaliseAgeing([{ id: "d2", name: "y", stage: "q", daysInStage: 5, limitDays: 14 }]);
    expect(rows2[0].exceededBy).toBe(0);
  });

  it("normalises stage limits from the API's maxDays/enabled shape", () => {
    const [row] = normaliseStageLimits({ limits: [{ stage: "qual", maxDays: 14, enabled: false }] });
    expect(row.maxDays).toBe(14);
    expect(row.enabled).toBe(false);
  });

  it("still reads a cached payload that used the old limitDays name", () => {
    // Offline caches written before the field name was corrected must not
    // regress to a 0-day limit.
    expect(normaliseStageLimits({ limits: [{ stage: "qual", limitDays: 21 }] })[0].maxDays).toBe(21);
  });

  it("extracts missing fields from a 422 body across shapes", () => {
    expect(extractMissingFields({ missingFields: ["value", "product"] })).toEqual(["value", "product"]);
    expect(extractMissingFields({ fields: ["quantity"] })).toEqual(["quantity"]);
    expect(extractMissingFields({ details: { missingFields: ["nextStep"] } })).toEqual(["nextStep"]);
    expect(extractMissingFields(null)).toEqual([]);
  });

  it("MandatoryFieldsError carries the field list", () => {
    const e = new MandatoryFieldsError("missing", ["value"]);
    expect(e.missingFields).toEqual(["value"]);
    expect(e).toBeInstanceOf(Error);
  });

  it("exposes stable field-key and outcome catalogues", () => {
    expect(OPP_FIELD_KEYS).toContain("competitors");
    expect(CLOSE_OUTCOMES).toEqual(["won", "lost", "cancelled", "on_hold"]);
  });
});
