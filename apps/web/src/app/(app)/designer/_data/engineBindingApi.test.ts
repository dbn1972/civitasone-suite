import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bindingFromDescriptor,
  fetchEngineRegistry,
  normalizeBindingsFromApi,
  newExemptionRow,
  previewEngineBinding,
} from "./engineBindingApi";
import type { EngineDescriptorUi } from "@/app/_components/ds/designer/engineBindingTypes";
import { hasFeeEngineBinding, percentInputToBps, bpsToPercentInput } from "@/app/_components/ds/designer/engineBindingTypes";

const descriptor: EngineDescriptorUi = {
  engineKey: "revenue.assessment",
  label: "Assessment",
  description: "PT",
  blocks: ["fee", "assessment"],
  available: true,
  configSchema: [],
  defaultConfig: {
    exemptionCategories: [{ code: "SENIOR", label: "Senior", percentBps: 1000 }],
    penaltyPercentBps: 1200,
    rebatePercentBps: 500,
    rebateWindowDays: 30,
    penaltyGraceDays: 15,
    hoaCode: "",
    extras: { businessService: "PT" },
  },
};

describe("engineBindingApi helpers (FN-21)", () => {
  it("normalizes API bindings and uppercases exemption codes", () => {
    const bindings = normalizeBindingsFromApi([
      {
        id: "11111111-1111-4111-8111-111111111111",
        block: "fee",
        engineKey: "revenue.assessment",
        config: {
          exemptionCategories: [{ code: "senior", label: "Senior", percentBps: 1000 }],
          hoaCode: "4100",
        },
      },
      { block: "fee" },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.config.exemptionCategories[0]!.code).toBe("SENIOR");
    expect(hasFeeEngineBinding(bindings)).toBe(true);
  });

  it("builds a binding from a registry descriptor", () => {
    const b = bindingFromDescriptor(descriptor, "fee");
    expect(b.engineKey).toBe("revenue.assessment");
    expect(b.config.extras.businessService).toBe("PT");
    expect(b.config.exemptionCategories).toHaveLength(1);
  });

  it("converts percent ↔ bps for Studio inputs", () => {
    expect(percentInputToBps("10")).toBe(1000);
    expect(bpsToPercentInput(1500)).toBe("15");
    expect(newExemptionRow().code).toBe("");
  });
});

/**
 * UX-016: fetchEngineRegistry and previewEngineBinding used to throw a raw
 * `Could not load engine registry (${status})`/`Preview failed (${status})`
 * (the latter falling further back to the raw response body text) — the
 * same class of leak useFormError closes for components (UX-003). This
 * module is a plain async data client, not a component, so it can't use
 * that hook; both now go through the same catalogued toHumanError
 * vocabulary instead.
 */
describe("engineBindingApi — never leaks raw status or server text on failure", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetchEngineRegistry throws a clerk-safe message, never the raw HTTP status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await fetchEngineRegistry("fee").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b500\b/);
    expect(message).toMatch(/couldn't load/i);
  });

  it("previewEngineBinding throws a clerk-safe message, never raw server text or status", async () => {
    fetchMock.mockResolvedValue(
      new Response("engine-service circuit open", { status: 502 }),
    );
    const err = await previewEngineBinding({
      binding: bindingFromDescriptor(descriptor, "fee"),
      basePrincipalMinor: 10000,
      selectedExemptions: [],
      applyRebate: false,
      applyPenalty: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b502\b/);
    expect(message).not.toContain("engine-service circuit open");
  });
});
