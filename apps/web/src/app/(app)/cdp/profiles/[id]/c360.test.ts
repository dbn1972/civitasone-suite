import { describe, it, expect } from "vitest";
import type { CDPProfileLineageEntry } from "@civitasone/types";
import {
  attributionCoveragePct,
  contributingSources,
  displayValue,
  lineageNewestFirst,
  resolveAttributeSources,
} from "./c360";

const CRM: CDPProfileLineageEntry = {
  source: "crm",
  sourceId: "contact-1",
  timestamp: "2026-01-01T00:00:00.000Z",
  attributes: ["name", "email"],
};

const HELPDESK: CDPProfileLineageEntry = {
  source: "helpdesk",
  sourceId: "ticket-9",
  timestamp: "2026-03-01T00:00:00.000Z",
  attributes: ["phone"],
};

describe("resolveAttributeSources", () => {
  it("attributes each value to the system that supplied it", () => {
    const sources = resolveAttributeSources({
      attributes: { name: "Asha", email: "asha@example.gov.in", phone: "9876543210" },
      sourceLineage: [CRM, HELPDESK],
    });

    expect(sources.map((s) => [s.key, s.source])).toEqual([
      ["email", "crm"],
      ["name", "crm"],
      ["phone", "helpdesk"],
    ]);
    expect(sources.find((s) => s.key === "phone")?.sourceId).toBe("ticket-9");
  });

  it("leaves an unclaimed attribute unattributed rather than guessing the newest source", () => {
    const sources = resolveAttributeSources({
      attributes: { name: "Asha", city: "Bhubaneswar" },
      sourceLineage: [CRM, HELPDESK],
    });

    const city = sources.find((s) => s.key === "city");
    expect(city?.source).toBeNull();
    expect(city?.sourceId).toBeNull();
    expect(city?.recordedAt).toBeNull();
  });

  it("lets the most recent claim win when two systems supplied the same attribute", () => {
    const sources = resolveAttributeSources({
      attributes: { email: "new@example.gov.in" },
      sourceLineage: [
        CRM,
        { source: "citizen_portal", sourceId: "sub-4", timestamp: "2026-06-01T00:00:00.000Z", attributes: ["email"] },
      ],
    });

    expect(sources[0]?.source).toBe("citizen_portal");
    expect(sources[0]?.recordedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("keeps the later append when two claims share a timestamp", () => {
    const sources = resolveAttributeSources({
      attributes: { email: "x@example.gov.in" },
      sourceLineage: [
        { source: "first", sourceId: "a", timestamp: "2026-06-01T00:00:00.000Z", attributes: ["email"] },
        { source: "second", sourceId: "b", timestamp: "2026-06-01T00:00:00.000Z", attributes: ["email"] },
      ],
    });

    expect(sources[0]?.source).toBe("second");
  });

  it("ignores lineage entries that name no attributes", () => {
    const sources = resolveAttributeSources({
      attributes: { name: "Asha" },
      sourceLineage: [{ source: "legacy", sourceId: "l1", timestamp: "2026-05-01T00:00:00.000Z" }],
    });

    expect(sources[0]?.source).toBeNull();
  });

  it("sorts attributes by key so the table order is stable", () => {
    const sources = resolveAttributeSources({
      attributes: { zip: "751001", age: 42, name: "Asha" },
      sourceLineage: [],
    });

    expect(sources.map((s) => s.key)).toEqual(["age", "name", "zip"]);
  });

  it("handles an empty profile", () => {
    expect(resolveAttributeSources({ attributes: {}, sourceLineage: [] })).toEqual([]);
  });
});

describe("displayValue", () => {
  it("renders scalars, arrays and objects readably", () => {
    expect(displayValue("Asha")).toBe("Asha");
    expect(displayValue(42)).toBe("42");
    expect(displayValue(false)).toBe("false");
    expect(displayValue(["a", "b"])).toBe("a, b");
    expect(displayValue({ tier: "gold" })).toBe('{"tier":"gold"}');
  });

  it("shows an em dash for absent or blank values", () => {
    expect(displayValue(null)).toBe("—");
    expect(displayValue(undefined)).toBe("—");
    expect(displayValue("   ")).toBe("—");
    expect(displayValue([])).toBe("—");
  });
});

describe("attributionCoveragePct", () => {
  it("measures the share of attributes with a named source", () => {
    const sources = resolveAttributeSources({
      attributes: { name: "Asha", email: "a@b.gov.in", city: "Cuttack", state: "Odisha" },
      sourceLineage: [CRM],
    });

    expect(attributionCoveragePct(sources)).toBe(50);
  });

  it("reports zero coverage for a profile with no attributes", () => {
    expect(attributionCoveragePct([])).toBe(0);
  });

  it("reports full coverage when every attribute is claimed", () => {
    const sources = resolveAttributeSources({
      attributes: { name: "Asha", email: "a@b.gov.in" },
      sourceLineage: [CRM],
    });

    expect(attributionCoveragePct(sources)).toBe(100);
  });
});

describe("contributingSources", () => {
  it("lists each system once, most recent contribution first", () => {
    const result = contributingSources([
      CRM,
      HELPDESK,
      { source: "crm", sourceId: "contact-2", timestamp: "2026-07-01T00:00:00.000Z" },
    ]);

    expect(result).toEqual([
      { source: "crm", lastSeen: "2026-07-01T00:00:00.000Z" },
      { source: "helpdesk", lastSeen: "2026-03-01T00:00:00.000Z" },
    ]);
  });

  it("returns nothing for an empty trail", () => {
    expect(contributingSources([])).toEqual([]);
  });
});

describe("lineageNewestFirst", () => {
  it("reverses the append-only trail without mutating it", () => {
    const trail = [CRM, HELPDESK];
    expect(lineageNewestFirst(trail).map((e) => e.source)).toEqual(["helpdesk", "crm"]);
    expect(trail.map((e) => e.source)).toEqual(["crm", "helpdesk"]);
  });
});
