/**
 * FF-02 WP1 — defineContract DSL tests (design section 2.2; D-18).
 *
 * The DSL carries the load-bearing D-18 rules, so each is proved here:
 *   - money on the wire is a STRING: the CANONICAL `zMoneyMinorString` codec is
 *     ACCEPTED (string|number union whose wire form is the string branch), while
 *     a bare `z.number()` / number-only money field is REJECTED (house rule 4);
 *   - from schema v2 a required `currency` is mandatory when money is carried,
 *     and v1 does NOT require it;
 *   - one owner and one kind per topic (NEW-002 / R2R-017);
 *   - a `tenantId` field ⇒ invariant I5 (`hasTenantId`);
 *   - the reader is tolerant (unknown keys pass through);
 *   - `build` / `payload` / `validate` / `assert`, including `assert` being a
 *     no-op under mode=off and a non-throwing warn under mode=warn.
 *
 * The money cases import the REAL `zMoneyMinorString` from `@civitasone/schemas`
 * (NOT a hand-written copy), so this is a true integration of the canonical
 * codec with the contract DSL.
 */
import { afterEach, describe, it, expect } from "vitest";
import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas/money";
import {
  defineContract,
  getContract,
  listContracts,
  resetContracts,
  ContractDefinitionError,
} from "../../src/contracts/define.js";
import { type ContractModeEnv } from "../../src/contracts/modes.js";
import { ContractViolationError } from "../../src/contracts/errors.js";

// Each test owns a clean registry so topic names never collide across tests.
afterEach(() => resetContracts());

const env = (over: Partial<ContractModeEnv> = {}): ContractModeEnv => ({
  EVENT_CONTRACT_MODE: undefined,
  EVENT_CONTRACT_ENFORCE_TENANTS: undefined,
  ...over,
});

describe("defineContract — money on the wire (D-18 / house rule 4)", () => {
  it("ACCEPTS the canonical zMoneyMinorString codec (string|number union)", () => {
    // The exact helper every downstream money contract uses. It must load.
    const contract = defineContract({
      topic: "billing.invoice.paid",
      kind: "event",
      owner: "billing-service",
      version: "1.0",
      schema: z.object({ invoiceId: z.string(), totalMinor: zMoneyMinorString }),
      pii: [],
    });
    expect(contract.topic).toBe("billing.invoice.paid");
    // The walker sees the codec's pre-transform INPUT (a string|number union).
    const node = contract.shapeNode;
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields.totalMinor.type.kind).toBe("union");
  });

  it("REJECTS a bare z.number() money field", () => {
    expect(() =>
      defineContract({
        topic: "hrms.claim.approved",
        kind: "event",
        owner: "hrms-service",
        version: "1.0",
        schema: z.object({ claimId: z.string(), approvedAmountMinor: z.number() }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("REJECTS a number-only union money field (no string branch on the wire)", () => {
    expect(() =>
      defineContract({
        topic: "payroll.net.paid",
        kind: "event",
        owner: "payroll-service",
        version: "1.0",
        schema: z.object({ netMinor: z.union([z.number().int(), z.number()]) }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("the rejection message names the field and points at zMoneyMinorString (not a misleading claim)", () => {
    try {
      defineContract({
        topic: "refund.disbursement.initiated",
        kind: "event",
        owner: "refund-service",
        version: "1.0",
        schema: z.object({ amountMinor: z.number() }),
        pii: [],
      });
      throw new Error("expected a ContractDefinitionError");
    } catch (err) {
      expect(err).toBeInstanceOf(ContractDefinitionError);
      const msg = (err as Error).message;
      expect(msg).toContain("amountMinor");
      expect(msg).toContain("zMoneyMinorString");
      expect(msg).toContain("string on the wire");
    }
  });
});

describe("defineContract — currency required from schema v2 (D-18)", () => {
  it("v1 with money does NOT require currency", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.paid",
        kind: "event",
        owner: "billing-service",
        version: "1.9",
        schema: z.object({ invoiceId: z.string(), totalMinor: zMoneyMinorString }),
        pii: [],
      }),
    ).not.toThrow();
  });

  it("v2 with money and NO currency throws", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.paid.v2",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({ invoiceId: z.string(), totalMinor: zMoneyMinorString }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("v2 with money and an OPTIONAL currency still throws (currency must be required)", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.paid.v2",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({
          invoiceId: z.string(),
          totalMinor: zMoneyMinorString,
          currency: z.string().optional(),
        }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("v2 with money and a REQUIRED currency is accepted", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.paid.v2",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({
          invoiceId: z.string(),
          totalMinor: zMoneyMinorString,
          currency: z.string(),
        }),
        pii: [],
      }),
    ).not.toThrow();
  });

  it("v2 with NO money does not require currency", () => {
    expect(() =>
      defineContract({
        topic: "citizen.service_request.submitted.v2",
        kind: "event",
        owner: "citizen-service",
        version: "2.0",
        schema: z.object({ requestId: z.string() }),
        pii: [],
      }),
    ).not.toThrow();
  });
});

describe("defineContract — one owner / one kind per topic (NEW-002 / R2R-017)", () => {
  it("a duplicate topic throws", () => {
    defineContract({
      topic: "procurement.three_way_match.passed",
      kind: "event",
      owner: "procurement-service",
      version: "1.0",
      schema: z.object({ poId: z.string() }),
      pii: [],
    });
    expect(() =>
      defineContract({
        topic: "procurement.three_way_match.passed",
        kind: "event",
        owner: "finance-service",
        version: "1.0",
        schema: z.object({ poId: z.string() }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("the same topic as event then command throws (one kind per topic)", () => {
    defineContract({
      topic: "audit.para.pending_recovery",
      kind: "event",
      owner: "audit-service",
      version: "1.0",
      schema: z.object({ paraId: z.string() }),
      pii: [],
    });
    expect(() =>
      defineContract({
        topic: "audit.para.pending_recovery",
        kind: "command",
        owner: "audit-service",
        version: "1.0",
        schema: z.object({ paraId: z.string() }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("rejects a malformed version", () => {
    expect(() =>
      defineContract({
        topic: "x.y.z",
        kind: "event",
        owner: "x-service",
        version: "1",
        schema: z.object({ id: z.string() }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("rejects a non-object top-level schema (walker subset)", () => {
    expect(() =>
      defineContract({
        topic: "x.y.scalar",
        kind: "event",
        owner: "x-service",
        version: "1.0",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: z.string() as any,
        pii: [],
      }),
    ).toThrow();
  });
});

describe("defineContract — tenantId ⇒ I5 (hasTenantId)", () => {
  it("a payload with tenantId sets hasTenantId", () => {
    const c = defineContract({
      topic: "hrms.claim.approved",
      kind: "event",
      owner: "hrms-service",
      version: "1.0",
      schema: z.object({ claimId: z.string(), tenantId: z.string() }),
      pii: [],
    });
    expect(c.hasTenantId).toBe(true);
  });

  it("a payload with no tenantId leaves hasTenantId false", () => {
    const c = defineContract({
      topic: "billing.invoice.paid",
      kind: "event",
      owner: "billing-service",
      version: "1.0",
      schema: z.object({ invoiceId: z.string() }),
      pii: [],
    });
    expect(c.hasTenantId).toBe(false);
  });
});

describe("defineContract — tolerant reader (passthrough)", () => {
  it("accepts unknown keys so a newer producer does not break an older consumer", () => {
    const c = defineContract({
      topic: "billing.invoice.paid",
      kind: "event",
      owner: "billing-service",
      version: "1.0",
      schema: z.object({ invoiceId: z.string() }),
      pii: [],
    });
    const result = c.validate({ invoiceId: "inv-1", extraFutureField: "ignored" });
    expect(result.ok).toBe(true);
    // payload() keeps the known fields and does not strip the unknown one.
    const read = c.payload({ payload: { invoiceId: "inv-1", extraFutureField: "ignored" } });
    expect(read.invoiceId).toBe("inv-1");
    expect((read as Record<string, unknown>).extraFutureField).toBe("ignored");
  });
});

describe("defineContract — build / payload / validate", () => {
  const make = () =>
    defineContract({
      topic: "billing.invoice.paid",
      kind: "event",
      owner: "billing-service",
      version: "1.0",
      schema: z.object({ invoiceId: z.string(), totalMinor: zMoneyMinorString }),
      pii: [],
    });

  it("build returns a validated payload with money normalised to a string", () => {
    const c = make();
    // zMoneyMinorString accepts a safe-integer number and normalises to a string.
    expect(c.build({ invoiceId: "inv-1", totalMinor: 12345 }).totalMinor).toBe("12345");
    expect(c.build({ invoiceId: "inv-1", totalMinor: "67890" }).totalMinor).toBe("67890");
  });

  it("build throws ContractViolationError (PII-safe) on a bad payload", () => {
    const c = make();
    try {
      // Missing invoiceId.
      c.build({ totalMinor: "1" } as never);
      throw new Error("expected a ContractViolationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ContractViolationError);
      const rec = (err as ContractViolationError).record;
      expect(rec.topic).toBe("billing.invoice.paid");
      expect(rec.issues.map((i) => i.path)).toContain("invoiceId");
      // Value-free: the error message must never echo the payload.
      expect((err as Error).message).not.toContain("totalMinor");
    }
  });

  it("payload() reads a message and validates it", () => {
    const c = make();
    const read = c.payload({ payload: { invoiceId: "inv-1", totalMinor: "500" } });
    expect(read.invoiceId).toBe("inv-1");
    expect(read.totalMinor).toBe("500");
  });

  it("validate() returns ok=false with a PII-safe record on a bad shape", () => {
    const c = make();
    const result = c.validate({ invoiceId: 123, totalMinor: "1" });
    expect(result.ok).toBe(false);
    expect(result.violation?.code).toBe("CONTRACT_INVALID");
    expect(result.violation?.issues.map((i) => i.path)).toContain("invoiceId");
    // No value, no zod "received ..." text.
    expect(JSON.stringify(result.violation)).not.toContain("received");
  });

  it("registry exposes the contract via getContract / listContracts", () => {
    const c = make();
    expect(getContract("billing.invoice.paid")).toBe(c);
    expect(listContracts()).toContain(c);
  });
});

describe("defineContract — assert() under each mode", () => {
  const makeEnforce = () =>
    defineContract({
      topic: "billing.invoice.paid",
      kind: "event",
      owner: "billing-service",
      version: "1.0",
      schema: z.object({ invoiceId: z.string() }),
      pii: [],
      mode: "enforce",
    });

  it("mode=off is a true no-op: returns null WITHOUT validating, even on a bad payload", () => {
    const c = makeEnforce();
    // Global default is off (EVENT_CONTRACT_MODE unset); an invalid payload must
    // not throw and must not produce a record.
    expect(c.assert({ nope: true }, "t-1", env())).toBeNull();
  });

  it("mode=warn returns the violation record and does NOT throw", () => {
    const c = makeEnforce();
    const rec = c.assert({ nope: true }, "t-1", env({ EVENT_CONTRACT_MODE: "warn" }));
    expect(rec).not.toBeNull();
    expect(rec?.code).toBe("CONTRACT_INVALID");
  });

  it("mode=warn returns null for a valid payload", () => {
    const c = makeEnforce();
    expect(c.assert({ invoiceId: "inv-1" }, "t-1", env({ EVENT_CONTRACT_MODE: "warn" }))).toBeNull();
  });

  it("mode=enforce throws ContractViolationError for a listed tenant", () => {
    const c = makeEnforce();
    expect(() =>
      c.assert({ nope: true }, "t-1", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-1" })),
    ).toThrow(ContractViolationError);
  });

  it("mode=enforce passes a valid payload (returns null)", () => {
    const c = makeEnforce();
    expect(
      c.assert({ invoiceId: "inv-1" }, "t-1", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-1" })),
    ).toBeNull();
  });

  it("an unlisted tenant under per_contract is capped to warn (no throw)", () => {
    const c = makeEnforce();
    const rec = c.assert({ nope: true }, "t-9", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-1" }));
    expect(rec).not.toBeNull();
  });
});

describe("defineContract — money at any depth (D-18 / house rule 4)", () => {
  it("REJECTS a bare z.number() money field inside an array of objects", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.lines",
        kind: "event",
        owner: "billing-service",
        version: "1.0",
        schema: z.object({
          lines: z.array(z.object({ amountMinor: z.number() })),
        }),
        pii: [],
      }),
    ).toThrow(/lines\[\]\.amountMinor/);
  });

  it("REJECTS a bare z.number() money field in a nested object", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.nested",
        kind: "event",
        owner: "billing-service",
        version: "1.0",
        schema: z.object({ inner: z.object({ amountMinor: z.number() }) }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("REJECTS nested bare number money behind nullable and union wrappers", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.wrapped",
        kind: "event",
        owner: "billing-service",
        version: "1.0",
        schema: z.object({
          lines: z.array(z.object({ amountMinor: z.number() })).nullable(),
        }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
    expect(() =>
      defineContract({
        topic: "billing.invoice.union",
        kind: "event",
        owner: "billing-service",
        version: "1.0",
        schema: z.object({
          detail: z.union([z.object({ amountMinor: z.number() }), z.object({ note: z.string() })]),
        }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("ACCEPTS nested zMoneyMinorString in arrays and objects (v1)", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.lines.ok",
        kind: "event",
        owner: "billing-service",
        version: "1.0",
        schema: z.object({
          lines: z.array(z.object({ amountMinor: zMoneyMinorString })),
          summary: z.object({ taxMinor: zMoneyMinorString }),
        }),
        pii: [],
      }),
    ).not.toThrow();
  });

  it("v1 is unaffected: nested money without currency is accepted", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.v1.nocurrency",
        kind: "event",
        owner: "billing-service",
        version: "1.3",
        schema: z.object({ lines: z.array(z.object({ amountMinor: zMoneyMinorString })) }),
        pii: [],
      }),
    ).not.toThrow();
  });

  it("v2 nested money with NO currency anywhere is rejected, naming the path", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.v2.nested",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({ lines: z.array(z.object({ amountMinor: zMoneyMinorString })) }),
        pii: [],
      }),
    ).toThrow(/lines\[\]/);
  });

  it("v2 nested money with only an OPTIONAL currency is rejected", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.v2.optcur",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({
          lines: z.array(z.object({ amountMinor: zMoneyMinorString, currency: z.string().optional() })),
        }),
        pii: [],
      }),
    ).toThrow(ContractDefinitionError);
  });

  it("v2 nested money is accepted with a required currency on the holding object", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.v2.linecur",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({
          lines: z.array(z.object({ amountMinor: zMoneyMinorString, currency: z.string() })),
        }),
        pii: [],
      }),
    ).not.toThrow();
  });

  it("v2 nested money is accepted with a required top-level currency", () => {
    expect(() =>
      defineContract({
        topic: "billing.invoice.v2.topcur",
        kind: "event",
        owner: "billing-service",
        version: "2.0",
        schema: z.object({
          currency: z.string(),
          lines: z.array(z.object({ amountMinor: zMoneyMinorString })),
        }),
        pii: [],
      }),
    ).not.toThrow();
  });
});
