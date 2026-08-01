/**
 * Coverage for the inbound cross-service contract `billing.rate.change_requested`
 * (src/modules/rates/consumer.ts + change-request-domain.ts + change-request-repo.ts).
 *
 * The repo is exercised for real against a table-aware fake transaction, so the
 * Drizzle query builders are covered rather than mocked away. Only db/outbox/cache
 * are stubbed.
 *
 * MONEY: the rate is minor units (paise) as a STRING on the wire and a bigint in
 * the row. Assertions below prove a value above 2^53 round-trips exactly and that a
 * JSON number is refused instead of silently truncated.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";
const PRODUCT_ID = "11111111-1111-4000-8000-000000000001";
const RATE_ID = "22222222-2222-4000-8000-000000000001";
const MESSAGE_ID = "99999999-9999-4000-8000-000000000001";

/** 2^53 + 1 — the smallest integer a JS double cannot represent exactly. */
const ABOVE_2_53 = "9007199254740993";
/** A realistically huge paise amount well beyond double precision. */
const HUGE_PAISE = "123456789012345678901";

const H = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  markProcessedMock: vi.fn(),
  enqueueMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => H.transactionMock(fn) },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => H.markProcessedMock(...a),
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.invalidateMock(...a),
    makeKey: (t: string, r: string, i: string) => `catalogue:${t}:${r}:${i}`,
    getOrLoad: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

import type { CommandEnvelope } from "@civitasone/queue";
import { handleBillingRateChangeRequested } from "../src/modules/rates/consumer.js";
import {
  decideRateChange,
  isOpenForRateChange,
  rateChangeRequestedPayloadSchema,
  summariseParseFailure,
  RATE_CHANGE_REJECTION_CODES,
} from "../src/modules/rates/change-request-domain.js";
import { products } from "../src/modules/products/schema.js";
import { productLifecycle } from "../src/modules/products/governance-schema.js";
import { rates } from "../src/modules/rates/schema.js";
import { rateChangeRequests } from "../src/modules/rates/change-request-schema.js";
import { EVENTS, CONSUMED_EVENTS } from "../src/topics.js";

// ─── Table-aware fake transaction ──────────────────────────────────────────────

interface World {
  product?: { id: string; lifecycleStatus: string } | null;
  lifecycleState?: string | null;
  rateExists?: boolean;
}

interface Captured {
  inserts: Array<{ table: unknown; values: Record<string, unknown> }>;
}

function buildTx(world: World): { tx: unknown; captured: Captured } {
  const captured: Captured = { inserts: [] };

  function rowsFor(table: unknown): unknown[] {
    if (table === products) return world.product ? [world.product] : [];
    if (table === productLifecycle) {
      return world.lifecycleState === undefined || world.lifecycleState === null
        ? []
        : [{ state: world.lifecycleState }];
    }
    if (table === rates) return world.rateExists === true ? [{ id: RATE_ID }] : [];
    return [];
  }

  function selectNode(): Record<string, unknown> {
    let table: unknown = null;
    const node: Record<string, unknown> = {};
    for (const method of ["where", "limit", "offset", "orderBy"]) node[method] = () => node;
    node["from"] = (t: unknown) => {
      table = t;
      return node;
    };
    node["then"] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(table)).then(ok, err);
    return node;
  }

  function insertNode(table: unknown): Record<string, unknown> {
    const node: Record<string, unknown> = {};
    node["values"] = (v: Record<string, unknown>) => {
      captured.inserts.push({ table, values: v });
      return node;
    };
    node["onConflictDoNothing"] = () => node;
    node["returning"] = () => node;
    node["then"] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(ok, err);
    return node;
  }

  return {
    tx: { select: () => selectNode(), insert: (t: unknown) => insertNode(t) },
    captured,
  };
}

/** Wire db.transaction to a fake tx built over `world`; returns the insert sink. */
function withWorld(world: World): Captured {
  const { tx, captured } = buildTx(world);
  H.transactionMock.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return captured;
}

function envelope(payload: unknown, overrides: Partial<CommandEnvelope<unknown>> = {}): CommandEnvelope<unknown> {
  return {
    messageId: MESSAGE_ID,
    type: CONSUMED_EVENTS.billingRateChangeRequested,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    timestamp: "2026-07-01T00:00:00.000Z",
    schemaVersion: "1.0",
    payload,
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "billing-req-001",
    productId: PRODUCT_ID,
    requestedRateMinor: "125000",
    currency: "INR",
    effectiveFrom: "2026-08-01",
    reason: "annual repricing",
    ...overrides,
  };
}

/** The single rate_change_requests row written by the handler. */
function recordedRow(captured: Captured): Record<string, unknown> {
  const rows = captured.inserts.filter((i) => i.table === rateChangeRequests);
  expect(rows).toHaveLength(1);
  return rows[0]!.values;
}

function enqueuedTopics(): string[] {
  return H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

function enqueuedPayload(topic: string): Record<string, unknown> {
  const call = H.enqueueMock.mock.calls.find((c) => (c[1] as { topic: string }).topic === topic);
  expect(call, `no enqueue for topic ${topic}`).toBeDefined();
  return (call![1] as { payload: Record<string, unknown> }).payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.markProcessedMock.mockResolvedValue(true);
  H.invalidateMock.mockResolvedValue(undefined);
});

// ─── Happy path ────────────────────────────────────────────────────────────────

describe("billing.rate.change_requested — happy path", () => {
  it("validates a request against an active product, records it accepted and emits the outcome", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(envelope(validPayload()));

    const row = recordedRow(captured);
    expect(row["outcome"]).toBe("accepted");
    expect(row["tenantId"]).toBe(TENANT);
    expect(row["sourceMessageId"]).toBe(MESSAGE_ID);
    expect(row["productId"]).toBe(PRODUCT_ID);
    expect(row["requestId"]).toBe("billing-req-001");
    expect(row["rejectionCode"]).toBeNull();
    // MONEY: bigint in the row, never a number.
    expect(row["requestedRateMinor"]).toBe(125000n);
    expect(typeof row["requestedRateMinor"]).toBe("bigint");

    expect(enqueuedTopics()).toEqual([EVENTS.rateChangeRequestAccepted, "audit.event.record"]);
    const evt = enqueuedPayload(EVENTS.rateChangeRequestAccepted);
    expect(evt["outcome"]).toBe("accepted");
    // MONEY: string on the wire.
    expect(evt["requestedRateMinor"]).toBe("125000");
    expect(evt["rejectionCode"]).toBeUndefined();
    expect(evt["recordId"]).toBe(row["id"]);
  });

  it("audits the mutation and invalidates cache only after the transaction", async () => {
    withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(envelope(validPayload()));

    const audit = enqueuedPayload("audit.event.record");
    expect(audit["service"]).toBe("catalogue");
    expect(audit["resourceType"]).toBe("rate_change_request");
    expect(audit["outcome"]).toBe("accepted");
    expect(audit["sourceMessageId"]).toBe(MESSAGE_ID);

    expect(H.invalidateMock).toHaveBeenCalledWith(`catalogue:${TENANT}:rate_change_requests:${PRODUCT_ID}`);
    // Cache invalidation must not be inside the transaction.
    expect(H.transactionMock.mock.invocationCallOrder[0]!).toBeLessThan(
      H.invalidateMock.mock.invocationCallOrder[0]!,
    );
  });

  it("accepts a request naming a rate that belongs to the product", async () => {
    const captured = withWorld({
      product: { id: PRODUCT_ID, lifecycleStatus: "active" },
      lifecycleState: "sunset",
      rateExists: true,
    });

    await handleBillingRateChangeRequested(envelope(validPayload({ rateId: RATE_ID })));

    const row = recordedRow(captured);
    expect(row["outcome"]).toBe("accepted");
    expect(row["rateId"]).toBe(RATE_ID);
  });

  it("accepts a product with no lifecycle history (tracking predates PC-002)", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: null });

    await handleBillingRateChangeRequested(envelope(validPayload()));

    expect(recordedRow(captured)["outcome"]).toBe("accepted");
  });

  it("falls back to the messageId when the foreign envelope omits a correlationId", async () => {
    withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(
      envelope(validPayload(), { correlationId: "" as unknown as string }),
    );

    expect((H.enqueueMock.mock.calls[0]![1] as { correlationId: string }).correlationId).toBe(MESSAGE_ID);
  });
});

// ─── Idempotency (the load-bearing assertion) ─────────────────────────────────

describe("billing.rate.change_requested — idempotency", () => {
  it("processes the same messageId exactly once: the redelivery is a total no-op", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });
    const msg = envelope(validPayload());

    // First delivery claims the message; the redelivery finds it already claimed.
    H.markProcessedMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await handleBillingRateChangeRequested(msg);
    await handleBillingRateChangeRequested(msg);

    expect(H.markProcessedMock).toHaveBeenCalledTimes(2);
    // Exactly one row written, exactly one outcome event + one audit event.
    expect(captured.inserts.filter((i) => i.table === rateChangeRequests)).toHaveLength(1);
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueuedTopics()).toEqual([EVENTS.rateChangeRequestAccepted, "audit.event.record"]);
    // No post-commit side effect for the redelivery either.
    expect(H.invalidateMock).toHaveBeenCalledTimes(1);
  });

  it("claims the message before doing anything else in the transaction", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });
    H.markProcessedMock.mockResolvedValue(false);

    await handleBillingRateChangeRequested(envelope(validPayload()));

    // markProcessed returned false, so nothing at all happened.
    expect(captured.inserts).toHaveLength(0);
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.invalidateMock).not.toHaveBeenCalled();
  });
});

// ─── Rejection paths ───────────────────────────────────────────────────────────

describe("billing.rate.change_requested — rejection paths", () => {
  it("rejects an unknown product without throwing", async () => {
    const captured = withWorld({ product: null });

    await expect(handleBillingRateChangeRequested(envelope(validPayload()))).resolves.toBeUndefined();

    const row = recordedRow(captured);
    expect(row["outcome"]).toBe("rejected");
    expect(row["rejectionCode"]).toBe(RATE_CHANGE_REJECTION_CODES.productNotFound);
    expect(enqueuedTopics()).toEqual([EVENTS.rateChangeRequestRejected, "audit.event.record"]);
    expect(enqueuedPayload(EVENTS.rateChangeRequestRejected)["rejectionCode"]).toBe(
      RATE_CHANGE_REJECTION_CODES.productNotFound,
    );
  });

  it("rejects a retired product as closed to rate changes", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "retired" });

    await handleBillingRateChangeRequested(envelope(validPayload()));

    const row = recordedRow(captured);
    expect(row["outcome"]).toBe("rejected");
    expect(row["rejectionCode"]).toBe(RATE_CHANGE_REJECTION_CODES.lifecycleClosed);
    // The request detail is still recorded so the refusal is explainable.
    expect(row["requestedRateMinor"]).toBe(125000n);
  });

  it("rejects when the governed product status is retired even if no lifecycle row exists", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "retired" }, lifecycleState: null });

    await handleBillingRateChangeRequested(envelope(validPayload()));

    expect(recordedRow(captured)["rejectionCode"]).toBe(RATE_CHANGE_REJECTION_CODES.lifecycleClosed);
  });

  it("rejects a rate id that does not belong to the product", async () => {
    const captured = withWorld({
      product: { id: PRODUCT_ID, lifecycleStatus: "active" },
      lifecycleState: "active",
      rateExists: false,
    });

    await handleBillingRateChangeRequested(envelope(validPayload({ rateId: RATE_ID })));

    expect(recordedRow(captured)["rejectionCode"]).toBe(RATE_CHANGE_REJECTION_CODES.rateNotFound);
    expect(enqueuedTopics()).toContain(EVENTS.rateChangeRequestRejected);
  });
});

// ─── Malformed foreign payloads ────────────────────────────────────────────────

describe("billing.rate.change_requested — malformed foreign payloads", () => {
  const malformed: Array<[string, unknown]> = [
    ["missing every field", {}],
    ["productId not a uuid", validPayload({ productId: "not-a-uuid" })],
    ["requestedRateMinor absent", { requestId: "r", productId: PRODUCT_ID }],
    ["requestedRateMinor as a JSON number", validPayload({ requestedRateMinor: 125000 })],
    ["requestedRateMinor not numeric", validPayload({ requestedRateMinor: "12.50" })],
    ["effectiveFrom not an ISO date", validPayload({ effectiveFrom: "01/08/2026" })],
    ["payload is null", null],
    ["payload is a string", "garbage"],
    ["payload is an array", [1, 2, 3]],
  ];

  for (const [label, payload] of malformed) {
    it(`records a rejection without throwing — ${label}`, async () => {
      const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" } });

      await expect(handleBillingRateChangeRequested(envelope(payload))).resolves.toBeUndefined();

      const row = recordedRow(captured);
      expect(row["outcome"]).toBe("rejected");
      expect(row["rejectionCode"]).toBe(RATE_CHANGE_REJECTION_CODES.malformedPayload);
      // Envelope-derived columns are still populated so the row is attributable.
      expect(row["tenantId"]).toBe(TENANT);
      expect(row["createdBy"]).toBe(ACTOR);
      expect(enqueuedTopics()).toEqual([EVENTS.rateChangeRequestRejected, "audit.event.record"]);
      expect(enqueuedPayload(EVENTS.rateChangeRequestRejected)["requestedRateMinor"]).toBeNull();
    });
  }

  it("tolerates unknown extra fields added by billing later", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(
      envelope(validPayload({ someFutureField: "whatever", nested: { a: 1 } })),
    );

    expect(recordedRow(captured)["outcome"]).toBe("accepted");
  });

  it("tolerates missing optional fields", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(
      envelope({ requestId: "r-2", productId: PRODUCT_ID, requestedRateMinor: "1" }),
    );

    const row = recordedRow(captured);
    expect(row["outcome"]).toBe("accepted");
    expect(row["currency"]).toBeNull();
    expect(row["effectiveFrom"]).toBeNull();
    expect(row["rateId"]).toBeNull();
    expect(row["requestReason"]).toBeNull();
  });

  it("drops a message whose envelope cannot be trusted, without opening a transaction", async () => {
    withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" } });

    await expect(
      handleBillingRateChangeRequested(envelope(validPayload(), { tenantId: "not-a-uuid" })),
    ).resolves.toBeUndefined();
    await expect(
      handleBillingRateChangeRequested(envelope(validPayload(), { messageId: "not-a-uuid" })),
    ).resolves.toBeUndefined();
    await expect(
      handleBillingRateChangeRequested(envelope(validPayload(), { actorId: "" })),
    ).resolves.toBeUndefined();

    expect(H.transactionMock).not.toHaveBeenCalled();
    expect(H.markProcessedMock).not.toHaveBeenCalled();
  });

  it("does not fail the handler when post-commit cache invalidation fails", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });
    H.invalidateMock.mockRejectedValue(new Error("redis down"));

    await expect(handleBillingRateChangeRequested(envelope(validPayload()))).resolves.toBeUndefined();

    expect(recordedRow(captured)["outcome"]).toBe("accepted");
  });
});

// ─── Money precision ───────────────────────────────────────────────────────────

describe("billing.rate.change_requested — money precision", () => {
  it("round-trips 2^53 + 1 exactly", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(envelope(validPayload({ requestedRateMinor: ABOVE_2_53 })));

    const row = recordedRow(captured);
    expect(row["requestedRateMinor"]).toBe(BigInt(ABOVE_2_53));
    expect(enqueuedPayload(EVENTS.rateChangeRequestAccepted)["requestedRateMinor"]).toBe(ABOVE_2_53);
    // Proof the value is beyond double precision.
    expect(String(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
  });

  it("round-trips a 21-digit paise amount exactly", async () => {
    const captured = withWorld({ product: { id: PRODUCT_ID, lifecycleStatus: "active" }, lifecycleState: "active" });

    await handleBillingRateChangeRequested(envelope(validPayload({ requestedRateMinor: HUGE_PAISE })));

    expect(recordedRow(captured)["requestedRateMinor"]).toBe(BigInt(HUGE_PAISE));
    expect(enqueuedPayload(EVENTS.rateChangeRequestAccepted)["requestedRateMinor"]).toBe(HUGE_PAISE);
  });
});

// ─── Pure domain ───────────────────────────────────────────────────────────────

describe("rate change domain", () => {
  it("keeps sunset and closed_to_new_business open, closes retired", () => {
    expect(isOpenForRateChange("active", "active")).toBe(true);
    expect(isOpenForRateChange("sunset", "active")).toBe(true);
    expect(isOpenForRateChange("closed_to_new_business", "active")).toBe(true);
    expect(isOpenForRateChange(null, "draft")).toBe(true);
    expect(isOpenForRateChange("retired", "active")).toBe(false);
    expect(isOpenForRateChange("active", "retired")).toBe(false);
    expect(isOpenForRateChange(null, null)).toBe(true);
  });

  it("orders the decision table product → rate → lifecycle", () => {
    // A missing product wins over every other failure.
    expect(
      decideRateChange({ productExists: false, productStatus: null, lifecycleState: "retired", rateResolved: false }),
    ).toMatchObject({ outcome: "rejected", code: RATE_CHANGE_REJECTION_CODES.productNotFound });

    expect(
      decideRateChange({ productExists: true, productStatus: "active", lifecycleState: "retired", rateResolved: false }),
    ).toMatchObject({ outcome: "rejected", code: RATE_CHANGE_REJECTION_CODES.rateNotFound });

    expect(
      decideRateChange({ productExists: true, productStatus: "active", lifecycleState: "retired", rateResolved: null }),
    ).toMatchObject({ outcome: "rejected", code: RATE_CHANGE_REJECTION_CODES.lifecycleClosed });

    expect(
      decideRateChange({ productExists: true, productStatus: "active", lifecycleState: "active", rateResolved: true }),
    ).toEqual({ outcome: "accepted" });
  });

  it("names the closed state in the rejection reason", () => {
    const d = decideRateChange({
      productExists: true,
      productStatus: "active",
      lifecycleState: "retired",
      rateResolved: null,
    });
    expect(d.outcome).toBe("rejected");
    if (d.outcome === "rejected") expect(d.reason).toContain("retired");

    const fromStatus = decideRateChange({
      productExists: true,
      productStatus: "retired",
      lifecycleState: null,
      rateResolved: null,
    });
    if (fromStatus.outcome === "rejected") expect(fromStatus.reason).toContain("retired");
  });

  it("summarises a parse failure with field paths only — never the offending values", () => {
    const result = rateChangeRequestedPayloadSchema.safeParse({
      requestId: "r",
      productId: "secret-looking-value",
      requestedRateMinor: 42,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const summary = summariseParseFailure(result.error);
    expect(summary).toContain("productId");
    expect(summary).toContain("requestedRateMinor");
    expect(summary).not.toContain("secret-looking-value");
    expect(summary.length).toBeLessThanOrEqual(500);
  });

  it("summarises a root-level failure", () => {
    const result = rateChangeRequestedPayloadSchema.safeParse("not an object");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(summariseParseFailure(result.error)).toContain("(root)");
  });
});
