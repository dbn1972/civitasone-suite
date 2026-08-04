import { describe, it, expect } from "vitest";
import { ContactDetailSchema } from "@civitasone/schemas/web";

/**
 * Regression for the REQUEST-CHANGES finding: the backend returns explicit
 * `null` for unclassified contacts. With `.optional()` those nulls failed
 * safeParse and the detail page showed "Contact not found" for almost every
 * existing contact. The classification fields must be `.nullish()`.
 */
describe("ContactDetailSchema classification nullability (LQ-003)", () => {
  it("parses a contact whose classification fields are explicit null", () => {
    const parsed = ContactDetailSchema.safeParse({
      id: "c1",
      name: "Asha Rao",
      temperature: null,
      priority: null,
      segment: null,
      product: null,
      region: null,
      expectedValueMinor: null,
      expectedValueDisplay: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a contact that omits classification fields entirely", () => {
    const parsed = ContactDetailSchema.safeParse({ id: "c1", name: "Asha Rao" });
    expect(parsed.success).toBe(true);
  });

  it("still parses populated classification values", () => {
    const parsed = ContactDetailSchema.safeParse({
      id: "c1", name: "Asha Rao", temperature: "hot", priority: "high", segment: "Enterprise",
    });
    expect(parsed.success).toBe(true);
  });
});
