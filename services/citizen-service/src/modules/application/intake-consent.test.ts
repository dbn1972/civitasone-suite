import { describe, it, expect } from "vitest";
import { saveDraftBody } from "./intake-validators.js";

describe("GAP-CITIZEN-INTAKE-04 — assisted-entry consent at the save-draft boundary", () => {
  const base = { serviceId: "11111111-1111-4111-8111-111111111111" };

  it("accepts an assistedConsent boolean (not stripped as unknown)", () => {
    const parsed = saveDraftBody.parse({ ...base, channel: "counter", assistedConsent: true });
    expect(parsed.assistedConsent).toBe(true);
  });

  it("keeps assistedConsent optional for backward compatibility", () => {
    const parsed = saveDraftBody.parse(base);
    expect(parsed.assistedConsent).toBeUndefined();
    // channel defaults to portal.
    expect(parsed.channel).toBe("portal");
  });
});
