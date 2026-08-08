/**
 * Pack #25 — Templates & Preferences: domain logic + validators + versioning.
 *
 * Tests template CRUD validation, preference tri-state channels, version
 * immutability plan, and safe input boundary enforcement.
 */
import { describe, it, expect } from "vitest";
import {
  createTemplateBody,
  updateTemplateBody,
  setPrefsBody,
  updatePrefsBody,
} from "../src/modules/templates/validators.js";
import { planTemplateVersion, isSuperseded, type NewTemplateVersion } from "../src/modules/templates/versioning.js";
import type { TemplateView } from "../src/modules/templates/domain.js";

describe("createTemplateBody — zod validator", () => {
  it("passes for valid email template", () => {
    const result = createTemplateBody.safeParse({
      channel: "email",
      name: "Welcome Email",
      subject: "Welcome {{name}}",
      body: "<h1>Hello</h1>",
    });
    expect(result.success).toBe(true);
  });

  it("passes for SMS template without subject", () => {
    const result = createTemplateBody.safeParse({
      channel: "sms",
      name: "OTP",
      body: "Your OTP is {{code}}",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown channel", () => {
    const result = createTemplateBody.safeParse({
      channel: "telegram",
      name: "Test",
      body: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createTemplateBody.safeParse({
      channel: "email",
      name: "",
      body: "Body",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 128 chars", () => {
    const result = createTemplateBody.safeParse({
      channel: "push",
      name: "x".repeat(129),
      body: "Body",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty body", () => {
    const result = createTemplateBody.safeParse({
      channel: "in_app",
      name: "Alert",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects subject exceeding 256 chars", () => {
    const result = createTemplateBody.safeParse({
      channel: "email",
      name: "Test",
      subject: "x".repeat(257),
      body: "Body",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid channels", () => {
    for (const channel of ["email", "sms", "push", "in_app"]) {
      const result = createTemplateBody.safeParse({ channel, name: "T", body: "B" });
      expect(result.success).toBe(true);
    }
  });
});

describe("updateTemplateBody — zod validator", () => {
  it("passes with partial updates", () => {
    const result = updateTemplateBody.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("passes with empty object (all optional)", () => {
    const result = updateTemplateBody.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid channel", () => {
    const result = updateTemplateBody.safeParse({ channel: "telegram" });
    expect(result.success).toBe(false);
  });

  it("rejects body set to empty string", () => {
    const result = updateTemplateBody.safeParse({ body: "" });
    expect(result.success).toBe(false);
  });
});

describe("setPrefsBody — preference creation", () => {
  it("passes with all channels specified", () => {
    const result = setPrefsBody.safeParse({
      eventType: "order.completed",
      inApp: true,
      email: true,
      push: false,
      sms: true,
      whatsapp: null,
    });
    expect(result.success).toBe(true);
  });

  it("defaults inApp and email to true, push to false", () => {
    const result = setPrefsBody.safeParse({ eventType: "alert.fire" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inApp).toBe(true);
      expect(result.data.email).toBe(true);
      expect(result.data.push).toBe(false);
    }
  });

  it("sms and whatsapp are nullish — undefined means no choice", () => {
    const result = setPrefsBody.safeParse({ eventType: "promo.new" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sms).toBeUndefined();
      expect(result.data.whatsapp).toBeUndefined();
    }
  });

  it("rejects empty eventType", () => {
    const result = setPrefsBody.safeParse({ eventType: "" });
    expect(result.success).toBe(false);
  });

  it("rejects eventType exceeding 128 chars", () => {
    const result = setPrefsBody.safeParse({ eventType: "x".repeat(129) });
    expect(result.success).toBe(false);
  });
});

describe("updatePrefsBody — preference update", () => {
  it("passes with at least one channel", () => {
    const result = updatePrefsBody.safeParse({ email: false });
    expect(result.success).toBe(true);
  });

  it("rejects empty object — at least one channel required", () => {
    const result = updatePrefsBody.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts sms set to null (withdraw choice)", () => {
    const result = updatePrefsBody.safeParse({ sms: null });
    expect(result.success).toBe(true);
  });

  it("accepts multiple channels at once", () => {
    const result = updatePrefsBody.safeParse({ inApp: true, push: true, sms: false });
    expect(result.success).toBe(true);
  });
});

describe("planTemplateVersion — immutable versioning", () => {
  const old: TemplateView = {
    id: "aaaa1111-1111-4000-8000-000000000001",
    tenantId: "bbbb1111-1111-4000-8000-000000000001",
    channel: "email",
    name: "Welcome",
    subject: "Hello",
    body: "<h1>Welcome</h1>",
    status: "active",
    version: 3,
    supersededBy: null,
  };

  it("increments version by 1", () => {
    const plan = planTemplateVersion(old, "cccc1111-1111-4000-8000-000000000001");
    expect(plan.version).toBe(4);
  });

  it("references the old ID", () => {
    const plan = planTemplateVersion(old, "cccc1111-1111-4000-8000-000000000001");
    expect(plan.oldId).toBe(old.id);
  });

  it("assigns the new ID", () => {
    const newId = "cccc1111-1111-4000-8000-000000000002";
    const plan = planTemplateVersion(old, newId);
    expect(plan.newId).toBe(newId);
  });
});

describe("isSuperseded", () => {
  it("returns false when supersededBy is null (current version)", () => {
    expect(isSuperseded({ supersededBy: null } as TemplateView)).toBe(false);
  });

  it("returns true when supersededBy is set (old version)", () => {
    expect(isSuperseded({ supersededBy: "some-uuid" } as TemplateView)).toBe(true);
  });
});
