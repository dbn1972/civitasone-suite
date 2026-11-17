/** Tenant-profile B1: admin accepts the full catalogue edition set (pure schema tests, no DB). */
import { describe, expect, it } from "vitest";
import { ADMIN_EDITIONS } from "@civitasone/tenant-profile";
import { createTenantBody, editionChangeBody } from "../src/modules/tenants/validators.js";
import { editPayloadSchema } from "../src/modules/tenants/lifecycle-domain.js";
import { EDITIONS as INTEGRATION_EDITIONS } from "../src/modules/platform-integrations/commands.js";
import { adminEdition } from "../src/modules/tenants/tenant-created.js";
import { composesOnOnboard } from "@civitasone/tenant-profile";

const base = { name: "Sundar Trust", domain: "sundar.example.in", region: "ap-south-1", residency: "in" };

describe("admin edition enums are derived from the catalogue", () => {
  it("a section8 tenant can now be created / edited / edition-changed", () => {
    expect(createTenantBody.safeParse({ ...base, edition: "section8" }).success).toBe(true);
    expect(editionChangeBody.safeParse({ edition: "section8" }).success).toBe(true);
    expect(editPayloadSchema.safeParse({ edition: "section8" }).success).toBe(true);
    expect(INTEGRATION_EDITIONS).toContain("section8");
  });
  it("existing editions are unchanged and a bogus one is still rejected", () => {
    for (const e of ["govt_dept", "psu", "small_office"]) expect(createTenantBody.safeParse({ ...base, edition: e }).success, e).toBe(true);
    expect(createTenantBody.safeParse({ ...base, edition: "govt" }).success).toBe(false); // tenant-service word, not an admin edition
    expect(createTenantBody.safeParse({ ...base, edition: "martian" }).success).toBe(false);
  });
  it("every enum equals the catalogue ADMIN_EDITIONS", () => {
    expect([...INTEGRATION_EDITIONS]).toEqual([...ADMIN_EDITIONS]);
    expect(createTenantBody.shape.edition.options).toEqual([...ADMIN_EDITIONS]);
  });
  it("tenant-created mapping is catalogue-driven and every result is a valid admin edition", () => {
    expect(adminEdition("govt")).toBe("govt_dept");
    for (const e of ["psu", "small_office", "section8", "private", "ngo", "cooperative"]) {
      expect(adminEdition(e)).toBe(e);
      expect((ADMIN_EDITIONS as readonly string[]).includes(adminEdition(e)), e).toBe(true);
    }
  });
  it("onboard compose gate is catalogue data", () => {
    expect(composesOnOnboard("section8")).toBe(true);
    expect(composesOnOnboard("govt_dept")).toBe(false);
  });
});
