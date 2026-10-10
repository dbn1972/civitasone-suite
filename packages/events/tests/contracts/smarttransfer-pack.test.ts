/**
 * ST-M01-06 — SmartTransfer / Workforce Core contract pack C0 tests
 * (spec §11, §19; D-ST-19, D-ST-10, D-18).
 *
 * Proven here, for EVERY contract in the pack:
 *   1. a valid example payload passes `validate`/`build`;
 *   2. a missing `tenantId` FAILS under enforce (invariant I5 relies on it);
 *   3. the topic name is ≤ 45 characters after dot-to-dash (queue truncation,
 *      `bus.ts` TOPIC_BASE_MAX) — a per-contract assertion;
 *   4. the contract's own mode is `enforce` (D-ST-19), and `off`-mode is a no-op;
 *   5. each topic has exactly one owner and one kind, and the kind matches the
 *      naming convention (command vs event);
 *   6. no C0 payload carries money (no `*Minor` field at any depth); and the DSL
 *      still rejects a bare-number money field and a v2 money field with no
 *      currency, so the money rule is live for future revisions.
 *
 * The pack is imported for its SIDE EFFECT (each module-level `defineContract`
 * registers its topic). This test file does NOT call `resetContracts()`, so it
 * never fights the pack's own registrations.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas/money";
import {
  defineContract,
  ContractDefinitionError,
  getContract,
  type Contract,
} from "../../src/contracts/define.js";
import { ContractViolationError } from "../../src/contracts/errors.js";
import { type ContractModeEnv } from "../../src/contracts/modes.js";
import { type SchemaNode } from "../../src/contracts/walker.js";
import {
  smartTransferContractPack,
  smarttransferContracts,
  hrmsPostingContracts,
  TOPIC_BASE_MAX,
  topicDashForm,
} from "../../src/contracts/smarttransfer/index.js";

// Enforce actually fires only when the global switch is per_contract and the
// tenant is listed. This env turns on enforcement for the test tenant.
const enforceEnv = (over: Partial<ContractModeEnv> = {}): ContractModeEnv => ({
  EVENT_CONTRACT_MODE: "per_contract",
  EVENT_CONTRACT_ENFORCE_TENANTS: "*",
  ...over,
});
const offEnv = (): ContractModeEnv => ({
  EVENT_CONTRACT_MODE: "off",
  EVENT_CONTRACT_ENFORCE_TENANTS: "*",
});

const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * Build a MINIMAL valid payload for a walked schema node. Enough to satisfy
 * `safeParse` for every C0 shape (string/number/boolean/enum/literal/array/
 * object/union/nullable). Deterministic, value-free of any PII.
 */
function sample(node: SchemaNode): unknown {
  switch (node.kind) {
    case "string":
      return "x";
    case "number":
      return 1;
    case "boolean":
      return true;
    case "literal":
      return node.value;
    case "enum":
      return node.values[0];
    case "array":
      return [sample(node.element)];
    case "union":
      return sample(node.options[0]!);
    case "nullable":
      return null;
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(node.fields)) {
        if (field.required) out[key] = sample(field.type);
      }
      return out;
    }
  }
}

/** A valid example payload for a contract, with tenantId pinned to TENANT. */
function validExample(c: Contract<z.ZodRawShape>): Record<string, unknown> {
  const base = sample(c.shapeNode) as Record<string, unknown>;
  if (c.hasTenantId) base.tenantId = TENANT;
  return base;
}

/** Does any object in the tree carry a `*Minor` field? */
function carriesMoney(node: SchemaNode): boolean {
  switch (node.kind) {
    case "object":
      return Object.entries(node.fields).some(
        ([name, f]) => /Minor$/.test(name) || carriesMoney(f.type),
      );
    case "array":
      return carriesMoney(node.element);
    case "union":
      return node.options.some(carriesMoney);
    case "nullable":
      return carriesMoney(node.inner);
    default:
      return false;
  }
}

describe("SmartTransfer contract pack — surface", () => {
  it("defines all 21 smarttransfer.* and 5 hrms.posting.* topics (26 total)", () => {
    expect(smarttransferContracts.length).toBe(21);
    expect(hrmsPostingContracts.length).toBe(5);
    expect(smartTransferContractPack.length).toBe(26);
  });

  it("registers every pack topic in the module registry (single owner/kind)", () => {
    for (const c of smartTransferContractPack) {
      const registered = getContract(c.topic);
      expect(registered, `${c.topic} is not registered`).toBeDefined();
      expect(registered!.owner).toBe(c.owner);
      expect(registered!.kind).toBe(c.kind);
    }
  });

  it("has no duplicate topic (one owner per topic — DSL rule 1)", () => {
    const topics = smartTransferContractPack.map((c) => c.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("only smarttransfer.* and hrms.posting.* topics are in the pack", () => {
    for (const c of smartTransferContractPack) {
      expect(
        c.topic.startsWith("smarttransfer.") ||
          c.topic.startsWith("hrms.posting."),
        `${c.topic} is not a smarttransfer.*/hrms.posting.* topic`,
      ).toBe(true);
    }
  });
});

describe("SmartTransfer contract pack — D-ST-19 enforce mode", () => {
  it("every contract's own mode is enforce", () => {
    for (const c of smartTransferContractPack) {
      expect(c.mode, `${c.topic} must be enforce (D-ST-19)`).toBe("enforce");
    }
  });

  it("enforce resolves to enforce for a listed tenant, and warn for a relay (no tenant)", () => {
    for (const c of smartTransferContractPack) {
      expect(c.resolveMode(TENANT, enforceEnv())).toBe("enforce");
      // relay-time (no tenant) must never be enforce (poison-row protection).
      expect(c.resolveMode(undefined, enforceEnv())).toBe("warn");
    }
  });

  it("the global kill switch (EVENT_CONTRACT_MODE=off) turns every contract off", () => {
    for (const c of smartTransferContractPack) {
      expect(c.resolveMode(TENANT, offEnv())).toBe("off");
    }
  });
});

describe("SmartTransfer contract pack — topic-name length (bus.ts truncation)", () => {
  it(`every topic's dash form is ≤ ${TOPIC_BASE_MAX} characters (no queue truncation)`, () => {
    for (const c of smartTransferContractPack) {
      const dash = topicDashForm(c.topic);
      expect(dash).toBe(c.topic.replace(/\./g, "-"));
      expect(
        dash.length,
        `${c.topic} → '${dash}' is ${dash.length} chars (> ${TOPIC_BASE_MAX}); it would be truncated by bus.ts`,
      ).toBeLessThanOrEqual(TOPIC_BASE_MAX);
    }
  });
});

describe("SmartTransfer contract pack — valid example passes, tenant missing fails", () => {
  for (const c of smartTransferContractPack) {
    describe(c.topic, () => {
      it("a valid example payload passes validate() and build()", () => {
        const example = validExample(c);
        const result = c.validate(example);
        expect(result.ok, JSON.stringify(result.violation)).toBe(true);
        expect(() => c.build(example as never)).not.toThrow();
        // under enforce, a valid payload asserts cleanly (no throw, null record).
        expect(c.assert(example, TENANT, enforceEnv())).toBeNull();
      });

      it("carries a tenantId (invariant I5)", () => {
        expect(c.hasTenantId, `${c.topic} must carry tenantId`).toBe(true);
      });

      it("a payload MISSING tenantId throws under enforce", () => {
        const bad = validExample(c);
        delete bad.tenantId;
        expect(() => c.assert(bad, TENANT, enforceEnv())).toThrow(
          ContractViolationError,
        );
      });

      it("off-mode is a no-op even for an invalid payload", () => {
        const bad = validExample(c);
        delete bad.tenantId;
        expect(c.assert(bad, TENANT, offEnv())).toBeNull();
      });
    });
  }
});

describe("SmartTransfer contract pack — money rule (D-18 / house rule 4)", () => {
  it("no C0 topic carries money (no *Minor field at any depth)", () => {
    for (const c of smartTransferContractPack) {
      expect(
        carriesMoney(c.shapeNode),
        `${c.topic} unexpectedly carries money`,
      ).toBe(false);
    }
  });

  it("the DSL still REJECTS a bare-number money field (future-revision guard)", () => {
    expect(() =>
      defineContract({
        topic: "smarttransfer.__test.bare_number_money",
        kind: "event",
        owner: "smarttransfer-service",
        version: "1.0",
        schema: z.object({ tenantId: z.string(), amountMinor: z.number() }),
        pii: [],
        mode: "enforce",
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("the DSL REQUIRES currency on a v2 money field (D-18)", () => {
    expect(() =>
      defineContract({
        topic: "smarttransfer.__test.v2_money_no_currency",
        kind: "event",
        owner: "smarttransfer-service",
        version: "2.0",
        schema: z.object({
          tenantId: z.string(),
          amountMinor: zMoneyMinorString,
        }),
        pii: [],
        mode: "enforce",
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("a v2 money field WITH a required currency is accepted (string wire form)", () => {
    expect(() =>
      defineContract({
        topic: "smarttransfer.__test.v2_money_ok",
        kind: "event",
        owner: "smarttransfer-service",
        version: "2.0",
        schema: z.object({
          tenantId: z.string(),
          amountMinor: zMoneyMinorString,
          currency: z.string().length(3),
        }),
        pii: [],
        mode: "enforce",
      }),
    ).not.toThrow();
  });
});

describe("SmartTransfer contract pack — kind vs naming convention", () => {
  // commands: {service}.{aggregate}.{action}; events: {service}.{aggregate}.{past}.
  // The pack's commands are the write-path intents; everything else is an event.
  const commandTopics = new Set([
    "smarttransfer.run.requested",
    "smarttransfer.solve.requested",
    "hrms.posting.apply",
  ]);

  it("every contract declared a command is a command, and vice versa", () => {
    for (const c of smartTransferContractPack) {
      const expected = commandTopics.has(c.topic) ? "command" : "event";
      expect(c.kind, `${c.topic} kind`).toBe(expected);
    }
  });

  it("declares exactly the three expected commands", () => {
    const commands = smartTransferContractPack
      .filter((c) => c.kind === "command")
      .map((c) => c.topic)
      .sort();
    expect(commands).toEqual([...commandTopics].sort());
  });
});
