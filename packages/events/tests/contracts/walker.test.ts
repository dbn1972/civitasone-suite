/**
 * FF-02 WP1 — Schema walker + compatibility tests.
 *
 * The walker turns a contract's zod schema into a canonical JSON description
 * (fields, required, types, enums) over a FIXED subset of zod. It is the basis
 * for both the compatibility check (I6) and the committed snapshot (section
 * 2.3). Anything outside the subset must throw at author time, not silently
 * degrade.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  walkSchema,
  diffSchemas,
  SchemaWalkerError,
  type SchemaNode,
} from "../../src/contracts/walker.js";

describe("walkSchema — supported subset", () => {
  it("describes a flat object with required and optional fields", () => {
    const node = walkSchema(
      z.object({
        id: z.string(),
        count: z.number(),
        note: z.string().optional(),
      }),
    );
    expect(node.kind).toBe("object");
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields.id).toMatchObject({ type: { kind: "string" }, required: true });
    expect(node.fields.count).toMatchObject({ type: { kind: "number" }, required: true });
    expect(node.fields.note).toMatchObject({ required: false });
    expect(node.fields.note.type.kind).toBe("string");
  });

  it("treats nullable fields as still-required keys (presence) but nullable type", () => {
    const node = walkSchema(z.object({ ref: z.string().nullable() }));
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields.ref.required).toBe(true);
    expect(node.fields.ref.type.kind).toBe("nullable");
  });

  it("describes enum and literal", () => {
    const node = walkSchema(
      z.object({
        kind: z.enum(["receipt", "payment"]),
        flag: z.literal("ok"),
      }),
    );
    if (node.kind !== "object") throw new Error("expected object");
    const kind = node.fields.kind.type as Extract<SchemaNode, { kind: "enum" }>;
    expect(kind.kind).toBe("enum");
    expect(kind.values.sort()).toEqual(["payment", "receipt"]);
    const flag = node.fields.flag.type as Extract<SchemaNode, { kind: "literal" }>;
    expect(flag.kind).toBe("literal");
    expect(flag.value).toBe("ok");
  });

  it("describes arrays, nested objects and unions", () => {
    const node = walkSchema(
      z.object({
        lines: z.array(z.object({ sku: z.string(), qty: z.number() })),
        amount: z.union([z.string(), z.number()]),
      }),
    );
    if (node.kind !== "object") throw new Error("expected object");
    const lines = node.fields.lines.type as Extract<SchemaNode, { kind: "array" }>;
    expect(lines.kind).toBe("array");
    expect(lines.element.kind).toBe("object");
    const amount = node.fields.amount.type as Extract<SchemaNode, { kind: "union" }>;
    expect(amount.kind).toBe("union");
    expect(amount.options.map((o) => o.kind).sort()).toEqual(["number", "string"]);
  });

  it("is deterministic — same schema produces an equal description", () => {
    const schema = () => z.object({ b: z.number(), a: z.string().optional() });
    expect(walkSchema(schema())).toEqual(walkSchema(schema()));
  });

  it("sees through zod .transform() to the input shape (money string fields)", () => {
    // zMoneyMinorString is a union(...).transform(...); the walker must read
    // the pre-transform INPUT so money stays describable on the wire.
    const schema = z.object({
      amountMinor: z.union([z.string(), z.number()]).transform((v) => String(v)),
    });
    const node = walkSchema(schema);
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields.amountMinor.type.kind).toBe("union");
  });
});

describe("walkSchema — unsupported subset throws", () => {
  it("rejects a top-level non-object schema", () => {
    expect(() => walkSchema(z.string())).toThrow(SchemaWalkerError);
  });

  it("rejects an unsupported leaf type (record)", () => {
    expect(() => walkSchema(z.object({ meta: z.record(z.string()) }))).toThrow(SchemaWalkerError);
  });

  it("rejects z.any / z.unknown (would make the contract meaningless)", () => {
    expect(() => walkSchema(z.object({ x: z.any() }))).toThrow(SchemaWalkerError);
    expect(() => walkSchema(z.object({ x: z.unknown() }))).toThrow(SchemaWalkerError);
  });
});

describe("diffSchemas — compatibility (I6)", () => {
  const base = z.object({ id: z.string(), name: z.string(), note: z.string().optional() });

  it("additive optional field is compatible", () => {
    const next = z.object({
      id: z.string(),
      name: z.string(),
      note: z.string().optional(),
      extra: z.string().optional(),
    });
    expect(diffSchemas(walkSchema(base), walkSchema(next))).toEqual([]);
  });

  it("a removed field is breaking", () => {
    const next = z.object({ id: z.string(), note: z.string().optional() });
    const breaking = diffSchemas(walkSchema(base), walkSchema(next));
    expect(breaking.join(" ")).toContain("REMOVED_FIELD");
    expect(breaking.join(" ")).toContain("name");
  });

  it("a new required field is breaking", () => {
    const next = z.object({
      id: z.string(),
      name: z.string(),
      note: z.string().optional(),
      mustHave: z.string(),
    });
    const breaking = diffSchemas(walkSchema(base), walkSchema(next));
    expect(breaking.join(" ")).toContain("NEW_REQUIRED_FIELD");
  });

  it("optional → required is breaking", () => {
    const next = z.object({ id: z.string(), name: z.string(), note: z.string() });
    const breaking = diffSchemas(walkSchema(base), walkSchema(next));
    expect(breaking.join(" ")).toContain("FIELD_NOW_REQUIRED");
  });

  it("a changed field type is breaking", () => {
    const next = z.object({ id: z.number(), name: z.string(), note: z.string().optional() });
    const breaking = diffSchemas(walkSchema(base), walkSchema(next));
    expect(breaking.join(" ")).toContain("TYPE_CHANGED");
  });

  it("a widened enum (added member) is NOT breaking for a consumer; a removed member IS", () => {
    const v1 = z.object({ k: z.enum(["a", "b"]) });
    const v2 = z.object({ k: z.enum(["a", "b", "c"]) });
    expect(diffSchemas(walkSchema(v1), walkSchema(v2))).toEqual([]);
    const back = diffSchemas(walkSchema(v2), walkSchema(v1));
    expect(back.join(" ")).toContain("ENUM_MEMBER_REMOVED");
  });

  it("no change is compatible", () => {
    expect(diffSchemas(walkSchema(base), walkSchema(base))).toEqual([]);
  });
});
