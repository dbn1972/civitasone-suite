/**
 * CRM Service — Integrations Validators: Deep tests.
 * Source: modules/integrations/validators.ts
 */
import { describe, it, expect } from "vitest";
import { connectLinkedAccountBody, linkSyncedItemBody, PROVIDERS, SYNC_KINDS, SYNC_SUBJECT_TYPES } from "../src/modules/integrations/validators.js";

describe("PROVIDERS constant", () => {
  it("has 4 providers", () => expect([...PROVIDERS]).toEqual(["google", "o365", "imap", "caldav"]));
});

describe("connectLinkedAccountBody", () => {
  const valid = { provider: "google" as const, externalEmail: "user@gmail.com" };
  it("accepts valid", () => expect(connectLinkedAccountBody.safeParse(valid).success).toBe(true));
  it("rejects invalid provider", () => expect(connectLinkedAccountBody.safeParse({ ...valid, provider: "yahoo" }).success).toBe(false));
  it("rejects invalid email", () => expect(connectLinkedAccountBody.safeParse({ ...valid, externalEmail: "bad" }).success).toBe(false));
  it("rejects email > 320 chars", () => expect(connectLinkedAccountBody.safeParse({ ...valid, externalEmail: "x".repeat(310) + "@example.com" }).success).toBe(false));
  it("defaults scopes to []", () => {
    const r = connectLinkedAccountBody.safeParse(valid);
    expect(r.success && r.data.scopes).toEqual([]);
  });
  it("accepts scopes array", () => expect(connectLinkedAccountBody.safeParse({ ...valid, scopes: ["mail.read"] }).success).toBe(true));
  it("rejects > 50 scopes", () => expect(connectLinkedAccountBody.safeParse({ ...valid, scopes: Array(51).fill("x") }).success).toBe(false));
});

describe("linkSyncedItemBody", () => {
  const valid = { linkedAccountId: "10000000-aaaa-4000-8000-000000000001", kind: "email" as const, externalId: "msg-123", subjectType: "contact" as const, subjectId: "20000000-bbbb-4000-8000-000000000001" };
  it("accepts valid", () => expect(linkSyncedItemBody.safeParse(valid).success).toBe(true));
  it("rejects invalid kind", () => expect(linkSyncedItemBody.safeParse({ ...valid, kind: "sms" }).success).toBe(false));
  it("rejects invalid subjectType", () => expect(linkSyncedItemBody.safeParse({ ...valid, subjectType: "lead" }).success).toBe(false));
  it("rejects non-UUID linkedAccountId", () => expect(linkSyncedItemBody.safeParse({ ...valid, linkedAccountId: "bad" }).success).toBe(false));
  it("rejects empty externalId", () => expect(linkSyncedItemBody.safeParse({ ...valid, externalId: "" }).success).toBe(false));
  it("SYNC_KINDS", () => expect([...SYNC_KINDS]).toEqual(["email", "meeting"]));
  it("SYNC_SUBJECT_TYPES", () => expect([...SYNC_SUBJECT_TYPES]).toEqual(["contact", "account", "deal"]));
});
