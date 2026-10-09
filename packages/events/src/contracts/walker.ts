/**
 * FF-02 WP1 — In-house zod schema walker (D-18, design C2).
 *
 * Turns a contract's zod schema into a canonical, JSON-serialisable
 * description of its shape over a FIXED subset of zod. The description powers:
 *   - the committed `contracts.snapshot.json` (section 2.3), and
 *   - the compatibility diff (`diffSchemas`) that enforces invariant I6
 *     ("compatible evolution only").
 *
 * Why in-house (D-18 / design decision D1): `zod-to-json-schema` is not in the
 * lockfile and zod 3.23 has no built-in JSON Schema output. A ~150-line walker
 * over the exact subset we allow is smaller, has no new dependency, and — most
 * importantly — REJECTS anything outside the subset at author time rather than
 * silently degrading. A contract whose shape the walker cannot describe is a
 * contract we cannot diff for compatibility, so it must not be allowed.
 *
 * Supported subset: object, string, number, boolean, enum, literal, array,
 * optional, nullable, union. `.transform()`/`.refine()` (ZodEffects) are
 * unwrapped to their INPUT schema, so a money field built from
 * `z.union(...).transform(...)` is described by its pre-transform wire shape.
 */
import { type ZodTypeAny } from "zod";

export class SchemaWalkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaWalkerError";
  }
}

/** Canonical, JSON-serialisable description of a supported schema node. */
export type SchemaNode =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; element: SchemaNode }
  | { kind: "union"; options: SchemaNode[] }
  | { kind: "nullable"; inner: SchemaNode }
  | { kind: "object"; fields: Record<string, { required: boolean; type: SchemaNode }> };

const typeName = (schema: ZodTypeAny): string =>
  (schema?._def as { typeName?: string } | undefined)?.typeName ?? "unknown";

/**
 * Unwrap `.transform()` / `.refine()` / `.default()` / `.catch()` wrappers down
 * to the schema that describes the WIRE INPUT. Optional/nullable are handled by
 * the callers that care about field presence, so they are NOT unwrapped here.
 */
function unwrapEffects(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  // Bounded loop; schemas are shallow and this guards against a pathological cycle.
  for (let i = 0; i < 20; i += 1) {
    const def = current._def as { typeName?: string; schema?: ZodTypeAny; innerType?: ZodTypeAny };
    if (def.typeName === "ZodEffects" && def.schema) {
      current = def.schema;
      continue;
    }
    if ((def.typeName === "ZodDefault" || def.typeName === "ZodCatch") && def.innerType) {
      current = def.innerType;
      continue;
    }
    return current;
  }
  throw new SchemaWalkerError("schema nesting too deep (possible cycle)");
}

/** Walk a leaf/branch node (anything that is not an object field slot). */
function walkNode(schema: ZodTypeAny, path: string): SchemaNode {
  const s = unwrapEffects(schema);
  const name = typeName(s);

  switch (name) {
    case "ZodString":
      return { kind: "string" };
    case "ZodNumber":
      return { kind: "number" };
    case "ZodBoolean":
      return { kind: "boolean" };
    case "ZodLiteral": {
      const value = (s._def as { value: unknown }).value;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new SchemaWalkerError(`unsupported literal type at ${path}: only string/number/boolean literals are allowed`);
      }
      return { kind: "literal", value };
    }
    case "ZodEnum": {
      const values = (s._def as { values: readonly string[] }).values;
      return { kind: "enum", values: [...values] };
    }
    case "ZodNativeEnum":
      throw new SchemaWalkerError(`unsupported z.nativeEnum at ${path}: use z.enum([...]) so the members are explicit`);
    case "ZodArray": {
      const element = (s._def as { type: ZodTypeAny }).type;
      return { kind: "array", element: walkNode(element, `${path}[]`) };
    }
    case "ZodUnion": {
      const options = (s._def as { options: ZodTypeAny[] }).options;
      return { kind: "union", options: options.map((o, i) => walkNode(o, `${path}|${i}`)) };
    }
    case "ZodNullable": {
      const inner = (s._def as { innerType: ZodTypeAny }).innerType;
      return { kind: "nullable", inner: walkNode(inner, path) };
    }
    case "ZodOptional": {
      // A bare optional outside an object slot is described by its inner type;
      // field-level presence is tracked separately in walkObject().
      const inner = (s._def as { innerType: ZodTypeAny }).innerType;
      return walkNode(inner, path);
    }
    case "ZodObject":
      return walkObject(s, path);
    default:
      throw new SchemaWalkerError(
        `unsupported zod type '${name}' at ${path}. Supported: object, string, number, boolean, enum, literal, array, union, optional, nullable.`,
      );
  }
}

function walkObject(schema: ZodTypeAny, path: string): Extract<SchemaNode, { kind: "object" }> {
  const shape = (schema._def as { shape: () => Record<string, ZodTypeAny> }).shape();
  const fields: Record<string, { required: boolean; type: SchemaNode }> = {};
  // Sort keys for a deterministic, diffable description regardless of author order.
  for (const key of Object.keys(shape).sort()) {
    const raw = shape[key];
    if (!raw) continue;
    const field = unwrapEffects(raw);
    const required = typeName(field) !== "ZodOptional";
    fields[key] = { required, type: walkNode(field, path ? `${path}.${key}` : key) };
  }
  return { kind: "object", fields };
}

/**
 * Describe a contract schema. The top level MUST be an object: every event and
 * command payload in this repo is a keyed object, and a bare scalar payload
 * cannot carry the envelope-aligned fields (tenantId, ...) the gate relies on.
 */
export function walkSchema(schema: ZodTypeAny): SchemaNode {
  const s = unwrapEffects(schema);
  if (typeName(s) !== "ZodObject") {
    throw new SchemaWalkerError(
      `contract schema must be a z.object(...) at the top level, got '${typeName(s)}'`,
    );
  }
  return walkObject(s, "");
}

function sameType(a: SchemaNode, b: SchemaNode): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "literal":
      return a.value === (b as Extract<SchemaNode, { kind: "literal" }>).value;
    case "enum": {
      const bv = (b as Extract<SchemaNode, { kind: "enum" }>).values;
      return a.values.length === bv.length && [...a.values].sort().join("\u0000") === [...bv].sort().join("\u0000");
    }
    case "array":
      return sameType(a.element, (b as Extract<SchemaNode, { kind: "array" }>).element);
    case "nullable":
      return sameType(a.inner, (b as Extract<SchemaNode, { kind: "nullable" }>).inner);
    case "union": {
      const bo = (b as Extract<SchemaNode, { kind: "union" }>).options;
      if (a.options.length !== bo.length) return false;
      return a.options.every((opt) => bo.some((other) => sameType(opt, other)));
    }
    case "object": {
      const bf = (b as Extract<SchemaNode, { kind: "object" }>).fields;
      const ak = Object.keys(a.fields);
      const bk = Object.keys(bf);
      if (ak.length !== bk.length) return false;
      return ak.every((k) => {
        const af = a.fields[k];
        const other = bf[k];
        return Boolean(af && other) && other!.required === af!.required && sameType(af!.type, other!.type);
      });
    }
  }
}

/**
 * Compatibility diff for invariant I6. Returns the breaking changes between an
 * OLD description and a proposed NEW one (empty = compatible). A consumer of
 * the old version must be able to read a payload of the new version, so:
 *   - a removed field is breaking,
 *   - a new required field is breaking,
 *   - optional → required is breaking,
 *   - a changed field type is breaking,
 *   - a removed enum member is breaking (a producer may still send it);
 *     a NEW enum member is additive and compatible.
 */
export function diffSchemas(oldNode: SchemaNode, newNode: SchemaNode, path = ""): string[] {
  const breaking: string[] = [];
  if (oldNode.kind !== "object" || newNode.kind !== "object") {
    if (!sameType(oldNode, newNode)) {
      breaking.push(`TYPE_CHANGED: '${path || "<root>"}' changed shape`);
    }
    return breaking;
  }

  for (const [key, oldField] of Object.entries(oldNode.fields)) {
    const here = path ? `${path}.${key}` : key;
    const newField = newNode.fields[key];
    if (!newField) {
      breaking.push(`REMOVED_FIELD: '${here}' was removed (breaking for existing consumers)`);
      continue;
    }
    if (oldField.required && !newField.required) {
      // required → optional is a widening of what producers may omit; a
      // consumer that always read it could now get undefined. Treat as breaking.
      breaking.push(`FIELD_NOW_OPTIONAL: '${here}' changed from required to optional (breaking)`);
    }
    breaking.push(...diffTypes(oldField.type, newField.type, here));
  }

  for (const [key, newField] of Object.entries(newNode.fields)) {
    if (oldNode.fields[key]) {
      const here = path ? `${path}.${key}` : key;
      if (!oldNode.fields[key].required && newField.required) {
        breaking.push(`FIELD_NOW_REQUIRED: '${here}' changed from optional to required (breaking)`);
      }
      continue;
    }
    if (newField.required) {
      const here = path ? `${path}.${key}` : key;
      breaking.push(`NEW_REQUIRED_FIELD: '${here}' is new and required (breaking for existing publishers)`);
    }
  }

  return breaking;
}

function diffTypes(oldNode: SchemaNode, newNode: SchemaNode, path: string): string[] {
  if (oldNode.kind === "object" && newNode.kind === "object") {
    return diffSchemas(oldNode, newNode, path);
  }
  if (oldNode.kind === "enum" && newNode.kind === "enum") {
    const removed = oldNode.values.filter((v) => !newNode.values.includes(v));
    return removed.map((v) => `ENUM_MEMBER_REMOVED: '${path}' no longer accepts '${v}' (breaking for existing producers)`);
  }
  if (oldNode.kind === "array" && newNode.kind === "array") {
    return diffTypes(oldNode.element, newNode.element, `${path}[]`);
  }
  if (oldNode.kind === "nullable" && newNode.kind === "nullable") {
    return diffTypes(oldNode.inner, newNode.inner, path);
  }
  if (!sameType(oldNode, newNode)) {
    return [`TYPE_CHANGED: '${path}' changed type from '${oldNode.kind}' to '${newNode.kind}'`];
  }
  return [];
}

export type { ZodTypeAny };
