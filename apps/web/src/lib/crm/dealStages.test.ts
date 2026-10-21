import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEAL_STAGES,
  STAGE_DEFAULT_PROBABILITY,
  DEAL_STAGE_KEYS,
  DEAL_STAGE_LABEL_KEYS,
  DEAL_WIRE_STAGES,
  OPEN_STAGE_PATH,
  normalizeDealStage,
  toWireStage,
} from "./dealStages";
import { mapDealSummaries } from "@/app/_data/apiMappers";

describe("DEAL_STAGES (GAP-CRM-DEALS-NEW-02)", () => {
  it("every create-form option value round-trips through the mapper to its canonical stage", () => {
    for (const opt of DEAL_STAGES) {
      const out = mapDealSummaries([{ id: "1", dealName: "A", stage: opt.value, status: "open" }]);
      expect(out).not.toBeNull();
      expect(out![0].stage).toBe(opt.canonical);
    }
  });

  it("offers only open stages — never a terminal Won/Lost", () => {
    const values = DEAL_STAGES.map((s) => s.value);
    expect(values).not.toContain("Won");
    expect(values).not.toContain("Lost");
    // Matches the HIGH-batch GAP-CRM-DEALS-NEW-01 decision exactly.
    expect(values).toEqual(["Lead", "Proposal", "Negotiation"]);
  });

  it("has a probability default for every stage", () => {
    for (const opt of DEAL_STAGES) {
      expect(typeof STAGE_DEFAULT_PROBABILITY[opt.value]).toBe("number");
    }
  });
});

describe("normalizeDealStage / toWireStage (GAP-CRM-DEALS-NEW-02 single vocabulary)", () => {
  it.each([
    ["Lead", "prospecting"],
    ["lead", "prospecting"],
    ["Prospecting", "prospecting"],
    ["Qualification", "qualification"],
    ["Proposal", "proposal"],
    ["Negotiation", "negotiation"],
    ["Won", "closed_won"],
    ["Closed Won", "closed_won"],
    ["closed_won", "closed_won"],
    ["Lost", "closed_lost"],
    ["closed lost", "closed_lost"],
    ["  Negotiation  ", "negotiation"],
    ["Some New Backend Stage", "prospecting"],
  ])("normalises %j to %j", (raw, expected) => {
    expect(normalizeDealStage(raw)).toBe(expected);
  });

  it("returns null for an absent stage so the mapper drops the row", () => {
    expect(normalizeDealStage(null)).toBeNull();
    expect(normalizeDealStage("")).toBeNull();
  });

  it("every canonical key has a list label key and the open path is a subset of the keys", () => {
    for (const key of DEAL_STAGE_KEYS) expect(DEAL_STAGE_LABEL_KEYS[key]).toBeTruthy();
    for (const key of OPEN_STAGE_PATH) expect(DEAL_STAGE_KEYS).toContain(key);
  });

  it("every wire stage maps to a canonical key and a create option's wire value is a wire stage", () => {
    for (const w of DEAL_WIRE_STAGES) expect(DEAL_STAGE_KEYS).toContain(normalizeDealStage(w));
    for (const opt of DEAL_STAGES) expect(DEAL_WIRE_STAGES).toContain(opt.value);
  });

  it.each([
    ["lead", "Lead"],
    ["Proposal", "Proposal"],
    ["won", "Won"],
    ["NEGOTIATION", "Negotiation"],
  ])("toWireStage(%j) -> %j", (raw, expected) => {
    expect(toWireStage(raw)).toBe(expected);
  });

  it("toWireStage(null) -> null", () => {
    expect(toWireStage(null)).toBeNull();
  });
});

describe("the stage vocabulary has ONE home (GAP-CRM-DEALS-NEW-02)", () => {
  const web = join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(join(web, rel), "utf8");

  it("apiMappers imports its stage helpers from lib/crm/dealStages and keeps no local stage set", () => {
    const src = read("app/_data/apiMappers.ts");
    expect(src).toContain('from "@/lib/crm/dealStages"');
    expect(src).not.toMatch(/new Set\(\[\s*"prospecting"/);
    expect(src).not.toMatch(/new Set\(\[\s*"Lead"/);
    expect(src).not.toMatch(/function normalizeDealStage/);
  });

  it("DealsTable takes its label map, and the detail page its open path, from the shared module", () => {
    const table = read("app/(app)/crm/deals/DealsTable.tsx");
    expect(table).toContain('from "@/lib/crm/dealStages"');
    expect(table).not.toMatch(/closed_won\s*:\s*"stageConcluded"/);
    const detail = read("app/(app)/crm/deals/[id]/page.tsx");
    expect(detail).toContain('from "@/lib/crm/dealStages"');
    expect(detail).not.toMatch(/\[\s*"prospecting"\s*,\s*"qualification"/);
  });
});
