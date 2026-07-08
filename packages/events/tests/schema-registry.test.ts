/**
 * W2.2 — Schema Registry tests.
 *
 * PROPERTY: An incompatible schema change is rejected at publish.
 * Events validate against registered schemas. Unregistered types are blocked.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  registerSchema,
  validatePayload,
  checkBackwardCompatibility,
  listRegisteredTypes,
  listVersions,
  resetRegistry,
  SchemaRegistryError,
} from "../src/schema-registry.js";

beforeEach(() => resetRegistry());

describe("W2.2 — Schema registration", () => {
  it("registers and validates a conforming payload", () => {
    const schema = z.object({ billId: z.string().uuid(), amount: z.number() });
    registerSchema("finance.bill.created", "1.0", schema);

    expect(() => validatePayload("finance.bill.created", "1.0", {
      billId: "aaaaaaaa-0000-4000-8000-000000000001",
      amount: 5000,
    })).not.toThrow();
  });

  it("rejects unregistered event type", () => {
    expect(() => validatePayload("unknown.event", "1.0", {})).toThrow(SchemaRegistryError);
    expect(() => validatePayload("unknown.event", "1.0", {})).toThrow("No schema registered for event type");
  });

  it("rejects unregistered schema version", () => {
    registerSchema("test.event", "1.0", z.object({ name: z.string() }));
    expect(() => validatePayload("test.event", "2.0", { name: "x" })).toThrow("No schema registered for");
  });

  it("rejects invalid payload", () => {
    registerSchema("test.event", "1.0", z.object({ amount: z.number().positive() }));
    expect(() => validatePayload("test.event", "1.0", { amount: -5 })).toThrow("failed validation");
    expect(() => validatePayload("test.event", "1.0", { amount: "not a number" })).toThrow("failed validation");
  });

  it("is idempotent (re-register same type+version = no-op)", () => {
    const schema = z.object({ x: z.number() });
    registerSchema("t.e", "1.0", schema);
    registerSchema("t.e", "1.0", schema); // no throw
    expect(listVersions("t.e")).toEqual(["1.0"]);
  });

  it("lists registered types and versions", () => {
    registerSchema("a.b", "1.0", z.object({}));
    registerSchema("a.b", "2.0", z.object({}));
    registerSchema("c.d", "1.0", z.object({}));
    expect(listRegisteredTypes().sort()).toEqual(["a.b", "c.d"]);
    expect(listVersions("a.b")).toEqual(["1.0", "2.0"]);
  });
});

describe("W2.2 — Backward compatibility check", () => {
  it("additive optional field is compatible", () => {
    const oldKeys = new Set(["id", "name"]);
    const oldRequired = new Set(["id", "name"]);
    const newKeys = new Set(["id", "name", "description"]);
    const newRequired = new Set(["id", "name"]); // description is optional

    const breaking = checkBackwardCompatibility(oldKeys, oldRequired, newKeys, newRequired);
    expect(breaking).toHaveLength(0);
  });

  it("removed field is breaking", () => {
    const oldKeys = new Set(["id", "name", "email"]);
    const oldRequired = new Set(["id", "name"]);
    const newKeys = new Set(["id", "name"]); // email removed
    const newRequired = new Set(["id", "name"]);

    const breaking = checkBackwardCompatibility(oldKeys, oldRequired, newKeys, newRequired);
    expect(breaking.length).toBe(1);
    expect(breaking[0]).toContain("REMOVED_FIELD");
    expect(breaking[0]).toContain("email");
  });

  it("new required field is breaking", () => {
    const oldKeys = new Set(["id"]);
    const oldRequired = new Set(["id"]);
    const newKeys = new Set(["id", "mandatory_new"]);
    const newRequired = new Set(["id", "mandatory_new"]);

    const breaking = checkBackwardCompatibility(oldKeys, oldRequired, newKeys, newRequired);
    expect(breaking.some((b) => b.includes("NEW_REQUIRED_FIELD"))).toBe(true);
  });

  it("optional → required is breaking", () => {
    const oldKeys = new Set(["id", "notes"]);
    const oldRequired = new Set(["id"]); // notes was optional
    const newKeys = new Set(["id", "notes"]);
    const newRequired = new Set(["id", "notes"]); // notes now required

    const breaking = checkBackwardCompatibility(oldKeys, oldRequired, newKeys, newRequired);
    expect(breaking.some((b) => b.includes("FIELD_NOW_REQUIRED"))).toBe(true);
  });

  it("no changes = compatible", () => {
    const keys = new Set(["id", "name"]);
    const req = new Set(["id"]);
    expect(checkBackwardCompatibility(keys, req, keys, req)).toHaveLength(0);
  });
});
