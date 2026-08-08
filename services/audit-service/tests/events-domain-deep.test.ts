/**
 * Audit Service — Events Domain: Deep tests.
 *
 * Tests CERT-In tamper-evident hash chain computation — determinism,
 * chaining, content binding, and null handling.
 *
 * Source: modules/events/domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeHash } from "../src/modules/events/domain.js";

const BASE = {
  id: "ev-001", tenantId: "t-001", type: "user.login",
  occurredAt: "2026-07-01T10:00:00Z",
  content: { actor: { userId: "u-1" }, target: "session", payload: { ip: "10.0.0.1" } },
};

describe("computeHash — tamper-evident audit chain", () => {
  it("produces a 64-char hex string", () => {
    const hash = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same inputs = same hash)", () => {
    const h1 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    const h2 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    expect(h1).toBe(h2);
  });

  it("changes when id changes", () => {
    const h1 = computeHash("ev-001", BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    const h2 = computeHash("ev-002", BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    expect(h1).not.toBe(h2);
  });

  it("changes when tenantId changes", () => {
    const h1 = computeHash(BASE.id, "t-001", BASE.type, null, BASE.occurredAt, BASE.content);
    const h2 = computeHash(BASE.id, "t-002", BASE.type, null, BASE.occurredAt, BASE.content);
    expect(h1).not.toBe(h2);
  });

  it("changes when type changes", () => {
    const h1 = computeHash(BASE.id, BASE.tenantId, "user.login", null, BASE.occurredAt, BASE.content);
    const h2 = computeHash(BASE.id, BASE.tenantId, "user.logout", null, BASE.occurredAt, BASE.content);
    expect(h1).not.toBe(h2);
  });

  it("chains: different prevHash produces different result", () => {
    const h1 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    const h2 = computeHash(BASE.id, BASE.tenantId, BASE.type, "abc123", BASE.occurredAt, BASE.content);
    expect(h1).not.toBe(h2);
  });

  it("content binding: changing payload changes the hash", () => {
    const h1 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, BASE.content);
    const h2 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, { ...BASE.content, payload: { ip: "10.0.0.2" } });
    expect(h1).not.toBe(h2);
  });

  it("handles null actor/target/payload gracefully", () => {
    const hash = computeHash(BASE.id, BASE.tenantId, BASE.type, null, BASE.occurredAt, { actor: null, target: null, payload: null });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("timestamp binding: different occurredAt changes hash", () => {
    const h1 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, "2026-07-01T10:00:00Z", BASE.content);
    const h2 = computeHash(BASE.id, BASE.tenantId, BASE.type, null, "2026-07-01T10:00:01Z", BASE.content);
    expect(h1).not.toBe(h2);
  });
});
