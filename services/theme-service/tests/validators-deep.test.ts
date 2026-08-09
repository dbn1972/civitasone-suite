/**
 * Theme Service — Validators: Deep tests.
 * Source: modules/tokens/validators.ts (includes branding)
 */
import { describe, it, expect } from "vitest";
import { createTokenBody, upsertBrandBody, applyPresetBody, idParam } from "../src/modules/tokens/validators.js";

describe("createTokenBody", () => {
  it("accepts valid token", () => expect(createTokenBody.safeParse({ name: "primary", value: "#1a2b3c" }).success).toBe(true));
  it("rejects empty name", () => expect(createTokenBody.safeParse({ name: "", value: "x" }).success).toBe(false));
  it("rejects name > 128", () => expect(createTokenBody.safeParse({ name: "x".repeat(129), value: "x" }).success).toBe(false));
  it("rejects empty value", () => expect(createTokenBody.safeParse({ name: "x", value: "" }).success).toBe(false));
  it("rejects value > 512", () => expect(createTokenBody.safeParse({ name: "x", value: "x".repeat(513) }).success).toBe(false));
  it("category is optional", () => expect(createTokenBody.safeParse({ name: "x", value: "y" }).success).toBe(true));
});

describe("upsertBrandBody — branding", () => {
  it("accepts empty (all optional)", () => expect(upsertBrandBody.safeParse({}).success).toBe(true));
  it("accepts valid hex color", () => expect(upsertBrandBody.safeParse({ colorPrimary: "#1a2b3c" }).success).toBe(true));
  it("rejects invalid hex (no #)", () => expect(upsertBrandBody.safeParse({ colorPrimary: "1a2b3c" }).success).toBe(false));
  it("rejects short hex", () => expect(upsertBrandBody.safeParse({ colorPrimary: "#abc" }).success).toBe(false));
  it("accepts valid URL for logoUrl", () => expect(upsertBrandBody.safeParse({ logoUrl: "https://cdn.example.com/logo.png" }).success).toBe(true));
  it("rejects non-URL for logoUrl", () => expect(upsertBrandBody.safeParse({ logoUrl: "not-url" }).success).toBe(false));
  it("accepts sidebarStyle enum", () => {
    for (const s of ["default", "compact", "expanded"]) {
      expect(upsertBrandBody.safeParse({ sidebarStyle: s }).success).toBe(true);
    }
  });
  it("rejects invalid sidebarStyle", () => expect(upsertBrandBody.safeParse({ sidebarStyle: "hidden" }).success).toBe(false));
  it("accepts headerStyle enum", () => {
    for (const s of ["default", "minimal", "branded"]) {
      expect(upsertBrandBody.safeParse({ headerStyle: s }).success).toBe(true);
    }
  });
  it("rejects customCss > 16384", () => expect(upsertBrandBody.safeParse({ customCss: "x".repeat(16385) }).success).toBe(false));
});

describe("applyPresetBody", () => {
  it("accepts valid code", () => expect(applyPresetBody.safeParse({ code: "govt-blue" }).success).toBe(true));
  it("rejects empty code", () => expect(applyPresetBody.safeParse({ code: "" }).success).toBe(false));
  it("rejects code > 64", () => expect(applyPresetBody.safeParse({ code: "x".repeat(65) }).success).toBe(false));
});

describe("idParam", () => {
  it("accepts UUID", () => expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true));
  it("rejects non-UUID", () => expect(idParam.safeParse({ id: "bad" }).success).toBe(false));
});
