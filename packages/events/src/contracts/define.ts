/**
 * FF-02 WP1 — defineContract DSL (design C1, section 2.2; D-18).
 *
 * One `defineContract` per cross-service topic. A contract is CODE: producer
 * and consumer import the same definition, so a consumer that reads a field the
 * contract does not have fails to COMPILE (the structural fix for IXM-001/002/
 * 003). The DSL enforces, at load time:
 *
 *   1. One definition per topic. A second defineContract for a topic throws, so
 *      two services cannot own one topic (NEW-002).
 *   2. A topic cannot be both "event" and "command" (R2R-017).
 *   3. Money on the wire is a STRING only, and the field name ends in "Minor"
 *      (house rule 4 / D-18). From schema version >= 2, a "currency" field is
 *      REQUIRED whenever the payload carries any money field (D-18 / D-11).
 *   4. If the schema has a "tenantId" field, invariant I5 (payload tenant ==
 *      envelope tenant) is applied by the consumer gate automatically.
 *   5. Unknown keys are allowed (tolerant reader), so a producer on 1.1 does
 *      not break a consumer still on 1.0.
 *
 * The schema must pass the walker's subset check (walker.ts), because a shape
 * the walker cannot describe is a shape we cannot diff for compatibility (I6).
 */
import { z, type ZodObject, type ZodRawShape, type infer as zInfer } from "zod";
import { walkSchema, type SchemaNode } from "./walker.js";
import {
  resolveMode,
  modeEnvFromProcess,
  type ContractMode,
  type ContractModeEnv,
} from "./modes.js";
import {
  ContractViolationError,
  formatContractViolation,
  type ViolationRecord,
} from "./errors.js";

export class ContractDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDefinitionError";
  }
}

export type ContractKind = "event" | "command";
export type ContractVisibility = "internal" | "public";
export type ContractDelivery = "best_effort" | "required";

export interface DefineContractInput<Shape extends ZodRawShape> {
  topic: string;
  kind: ContractKind;
  /** The only service allowed to publish this topic. */
  owner: string;
  /** "major.minor". */
  version: string;
  /** Payload schema; must be a z.object and pass the walker subset. */
  schema: ZodObject<Shape>;
  /** PII field paths; [] must be explicit (DPDP erasure feeds off this). */
  pii: string[];
  /** "internal" (default) or "public" (webhook-eligible). */
  visibility?: ContractVisibility;
  /** Commands default to "required"; events to "best_effort". */
  delivery?: ContractDelivery;
  /** Declared consumer services (checked by the manifest gate, WP3). */
  consumers?: string[];
  /** Per-topic default mode (section 4.1). New contracts default to "off". */
  mode?: ContractMode;
}

export interface ValidationResult {
  ok: boolean;
  /** Present only when ok=false. PII-safe (no values, no zod message). */
  violation?: ViolationRecord;
}

export interface Contract<Shape extends ZodRawShape> {
  readonly topic: string;
  readonly kind: ContractKind;
  readonly owner: string;
  readonly version: string;
  readonly major: number;
  readonly schema: ZodObject<Shape>;
  readonly pii: readonly string[];
  readonly visibility: ContractVisibility;
  readonly delivery: ContractDelivery;
  readonly consumers: readonly string[];
  readonly mode: ContractMode;
  /** Canonical JSON description for the snapshot / compatibility diff. */
  readonly shapeNode: SchemaNode;
  /** Does the payload carry an envelope-aligned tenantId (invariant I5)? */
  readonly hasTenantId: boolean;

  /** Build a validated payload. Throws ContractViolationError on a bad shape. */
  build(input: zInfer<ZodObject<Shape>>): zInfer<ZodObject<Shape>>;
  /** Typed read of a message payload (compile-time safety for consumers). */
  payload(message: { payload: unknown }): zInfer<ZodObject<Shape>>;
  /** Non-throwing validation, PII-safe on failure. */
  validate(payload: unknown): ValidationResult;
  /** Effective mode for a (tenant, env) pair (section 4.2). */
  resolveMode(tenantId: string | undefined, env?: ContractModeEnv): ContractMode;
  /** Assert a payload under the effective mode; throws only when enforcing. */
  assert(payload: unknown, tenantId: string | undefined, env?: ContractModeEnv): ViolationRecord | null;
}

const VERSION_RE = /^(\d+)\.(\d+)$/;
const MONEY_FIELD_RE = /Minor$/;

/** Module-level registry; a second defineContract for a topic throws (rule 1). */
const registry = new Map<string, Contract<ZodRawShape>>();

/** Walk the object's top-level field slots so we can apply the money/tenant rules. */
function topLevelFields(node: SchemaNode): Record<string, { required: boolean; type: SchemaNode }> {
  if (node.kind !== "object") {
    throw new ContractDefinitionError("contract schema must be an object at the top level");
  }
  return node.fields;
}

/** Is this described node a plain wire STRING (string, or a union of strings)? */
function isWireString(type: SchemaNode): boolean {
  if (type.kind === "string") return true;
  if (type.kind === "literal") return typeof type.value === "string";
  // A money codec field is `z.union([z.string(), z.number()]).transform(String)`:
  // the walker sees the union INPUT. Money on the wire must be representable as
  // a string, so every union option must be a string or string-literal.
  if (type.kind === "union") return type.options.every(isWireString);
  if (type.kind === "nullable") return isWireString(type.inner);
  return false;
}

function enforceMoneyAndCurrency(topic: string, major: number, node: SchemaNode): void {
  const fields = topLevelFields(node);
  const moneyFields = Object.keys(fields).filter((k) => MONEY_FIELD_RE.test(k));

  for (const name of moneyFields) {
    const field = fields[name];
    if (field && !isWireString(field.type)) {
      throw new ContractDefinitionError(
        `contract '${topic}': money field '${name}' must be a string on the wire (house rule 4 / D-18). ` +
          `Use zMoneyMinorString (a string|number union transformed to a string), never a bare z.number().`,
      );
    }
  }

  // D-18 / D-11: from schema v2 a currency field is required whenever money is carried.
  if (major >= 2 && moneyFields.length > 0) {
    const currency = fields.currency;
    if (!currency || !currency.required) {
      throw new ContractDefinitionError(
        `contract '${topic}' v${major}.x carries money (${moneyFields.join(", ")}) so a required 'currency' ` +
          `field is mandatory from schema v2 (D-18).`,
      );
    }
  }
}

export function defineContract<Shape extends ZodRawShape>(
  input: DefineContractInput<Shape>,
): Contract<Shape> {
  const m = VERSION_RE.exec(input.version);
  if (!m) {
    throw new ContractDefinitionError(
      `contract '${input.topic}': version must be 'major.minor', got '${input.version}'`,
    );
  }
  const major = Number(m[1]);

  // Rule 1/2: single owner & kind per topic.
  const existing = registry.get(input.topic);
  if (existing) {
    throw new ContractDefinitionError(
      `contract '${input.topic}' is already defined (owner '${existing.owner}', kind '${existing.kind}'). ` +
        `A topic has exactly one owner and one kind (NEW-002 / R2R-017).`,
    );
  }

  // Walker subset check (throws SchemaWalkerError for an unsupported shape).
  const shapeNode = walkSchema(input.schema);

  // Rule 3: money/currency on the wire.
  enforceMoneyAndCurrency(input.topic, major, shapeNode);

  const fields = topLevelFields(shapeNode);
  const hasTenantId = Boolean(fields.tenantId); // rule 4 / I5

  const kind = input.kind;
  const delivery: ContractDelivery = input.delivery ?? (kind === "command" ? "required" : "best_effort");
  const mode: ContractMode = input.mode ?? "off"; // new contracts default to off (section 4.1)

  // Tolerant reader (rule 5): unknown keys are passed through.
  const schema = input.schema.passthrough() as unknown as ZodObject<Shape>;

  const validate = (payload: unknown): ValidationResult => {
    const parsed = schema.safeParse(payload);
    if (parsed.success) return { ok: true };
    return { ok: false, violation: formatContractViolation(input.topic, parsed) };
  };

  const contract: Contract<Shape> = {
    topic: input.topic,
    kind,
    owner: input.owner,
    version: input.version,
    major,
    schema,
    pii: Object.freeze([...input.pii]),
    visibility: input.visibility ?? "internal",
    delivery,
    consumers: Object.freeze([...(input.consumers ?? [])]),
    mode,
    shapeNode,
    hasTenantId,

    build(payloadInput) {
      const parsed = schema.safeParse(payloadInput);
      if (!parsed.success) {
        throw new ContractViolationError(formatContractViolation(input.topic, parsed));
      }
      return parsed.data as zInfer<ZodObject<Shape>>;
    },

    payload(message) {
      const parsed = schema.safeParse(message.payload);
      if (!parsed.success) {
        throw new ContractViolationError(formatContractViolation(input.topic, parsed));
      }
      return parsed.data as zInfer<ZodObject<Shape>>;
    },

    validate,

    resolveMode(tenantId, env = modeEnvFromProcess()) {
      return resolveMode(mode, tenantId, env);
    },

    assert(payload, tenantId, env = modeEnvFromProcess()) {
      const effective = resolveMode(mode, tenantId, env);
      if (effective === "off") return null;
      const result = validate(payload);
      if (result.ok) return null;
      if (effective === "enforce") {
        throw new ContractViolationError(result.violation!);
      }
      // warn: return the record for the caller to count/log; do not throw.
      return result.violation ?? null;
    },
  };

  registry.set(input.topic, contract as unknown as Contract<ZodRawShape>);
  return contract;
}

/** Look up a registered contract by topic. */
export function getContract(topic: string): Contract<ZodRawShape> | undefined {
  return registry.get(topic);
}

/** Every registered contract (for the manifest/snapshot generator, WP3). */
export function listContracts(): Contract<ZodRawShape>[] {
  return [...registry.values()];
}

/** Clear the registry — test helper only. */
export function resetContracts(): void {
  registry.clear();
}

export { z };
