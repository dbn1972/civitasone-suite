/**
 * certified-copy consumer tests — server-authoritative fee resolution, PII-free
 * events, and the version-guarded transition state machine (§30).
 *
 * db/outbox/repo/schema/config-registry are mocked; the REAL state machine, fee
 * math, and NonRetryableError are used so the transition/version/fee logic is
 * genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentCopy: { status: string; version: number; feeMinor: bigint } | undefined;
// Per-key config values consulted by getConfigValueOnTx (namespace "copy_fee").
let configValues: Record<string, unknown> = {};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, id: string) => {
    if (processedIds.has(id)) return false;
    processedIds.add(id);
    return true;
  }),
  enqueue: vi.fn(async () => {}),
  versionedUpdate: vi.fn(async () => {}),
}));

vi.mock("../src/modules/certified-copy/schema.js", () => ({ certifiedCopies: {} }));

vi.mock("../src/modules/certified-copy/repo.js", () => ({
  insertCopy: vi.fn(async () => {}),
  getCopyForUpdate: vi.fn(async () => currentCopy),
}));

vi.mock("../src/modules/config-registry/repo.js", () => ({
  getConfigValueOnTx: vi.fn(async (_tx: unknown, _tenant: string, _ns: string, key: string) => configValues[key]),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    requestCertifiedCopy: "court.copy.request",
    transitionCertifiedCopy: "court.copy.transition",
  },
  EVENTS: {
    certifiedCopyRequested: "court.copy.requested",
    certifiedCopyTransitioned: "court.copy.transitioned",
  },
}));

import { registerCertifiedCopyConsumers } from "../src/modules/certified-copy/consumer.js";
import * as repo from "../src/modules/certified-copy/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function requestMsg(
  id: string,
  extra: Partial<{ copiesCount: number; urgent: boolean; applicantName: string; feeMinorHint: string | number }> = {},
  messageId = id,
) {
  return {
    messageId, type: "court.copy.request",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(),
      copiesCount: extra.copiesCount ?? 1,
      urgent: extra.urgent ?? false,
      applicantName: extra.applicantName ?? "Ravi Kumar",
      ...(extra.feeMinorHint !== undefined ? { feeMinorHint: extra.feeMinorHint } : {}),
    },
  };
}

function transitionMsg(
  copyId: string,
  target: string,
  expectedVersion: number,
  opts: { deliveryMode?: string; remarks?: string; paymentRef?: string; receiptMinor?: string | number } = {},
  messageId = randomUUID(),
) {
  return {
    messageId, type: "court.copy.transition",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { copyId, tenantId: randomUUID(), target, expectedVersion, ...opts },
  };
}

function insertedRow(): Record<string, unknown> {
  return (repo.insertCopy as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
}
function requestedEvent(): { payload: Record<string, unknown> } | undefined {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[1] as { topic: string; payload: Record<string, unknown> })
    .find((e) => e.topic === "court.copy.requested");
}

describe("certified-copy consumer — request + server-authoritative fee", () => {
  beforeEach(() => { processedIds.clear(); currentCopy = undefined; configValues = {}; vi.clearAllMocks(); });

  it("requests a copy, resolves the config fee, and emits requested WITHOUT the applicant name", async () => {
    configValues = { standard: 1000 };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.request", requestMsg(randomUUID(), { copiesCount: 3 }));

    // Fee resolved server-side: 1000 paise/copy × 3 = 3000, source "config".
    expect(insertedRow()).toMatchObject({ feeMinor: 3000n, feeSource: "config", status: "requested" });
    // PII: cleartext name written to the encryptedText column (encrypted at rest).
    expect(insertedRow().applicantNameEnc).toBe("Ravi Kumar");

    const evt = requestedEvent();
    expect(evt?.payload).toMatchObject({ feeMinor: "3000", feeSource: "config", status: "requested" });
    // NO raw applicant PII in the event payload.
    expect(evt?.payload).not.toHaveProperty("applicantName");
    expect(evt?.payload).not.toHaveProperty("name");

    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.copy.requested");
    expect(topics).toContain("audit.event.record");
  });

  it("SERVER config fee overrides a client-supplied (tampered-low) hint", async () => {
    configValues = { standard: 2500 };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.request", requestMsg(randomUUID(), { copiesCount: 1, feeMinorHint: 1 }));
    expect(insertedRow()).toMatchObject({ feeMinor: 2500n, feeSource: "config" });
  });

  it("applies the urgent per-copy key plus the optional urgent surcharge", async () => {
    configValues = { urgent: 1500, urgent_surcharge: 250 };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.request", requestMsg(randomUUID(), { copiesCount: 2, urgent: true }));
    // 1500 × 2 + 250 surcharge = 3250.
    expect(insertedRow()).toMatchObject({ feeMinor: 3250n, feeSource: "config", urgent: true });
  });

  it("falls back to the client hint (then default) when no schedule is configured", async () => {
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.request", requestMsg(randomUUID(), { copiesCount: 2, feeMinorHint: 700 }));
    expect(insertedRow()).toMatchObject({ feeMinor: 1400n, feeSource: "client" });
  });

  it("uses the documented default per-copy fee when neither config nor a valid hint applies", async () => {
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.request", requestMsg(randomUUID(), { copiesCount: 2 }));
    expect(insertedRow()).toMatchObject({ feeMinor: 1000n, feeSource: "client" }); // 500 × 2
  });

  it("rejects a malformed copy_fee schedule value (poison) and does NOT insert", async () => {
    configValues = { standard: -5 };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await expect(deliver("court.copy.request", requestMsg(randomUUID())))
      .rejects.toThrow(/INVALID_COPY_FEE_SCHEDULE/);
    expect(repo.insertCopy).not.toHaveBeenCalled();
  });

  it("request is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    const m = requestMsg(randomUUID(), {}, "fixed");
    await deliver("court.copy.request", m);
    await deliver("court.copy.request", m);
    expect(repo.insertCopy).toHaveBeenCalledTimes(1);
  });
});

describe("certified-copy consumer — transition state machine", () => {
  beforeEach(() => { processedIds.clear(); currentCopy = undefined; configValues = {}; vi.clearAllMocks(); });

  it("advances a requested copy to fee_paid with matching payment proof and emits transitioned", async () => {
    currentCopy = { status: "requested", version: 1, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver(
      "court.copy.transition",
      transitionMsg("cp1", "fee_paid", 1, { paymentRef: "CHALLAN-1", receiptMinor: 1500 }),
    );
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const args = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { set: Record<string, unknown> };
    expect(args.set.paymentRef).toBe("CHALLAN-1");
    expect(args.set.receiptMinor).toBe(1500n);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.copy.transitioned");
  });

  it("rejects a fee_paid transition whose receiptMinor does not match the recorded fee (amount mismatch)", async () => {
    currentCopy = { status: "requested", version: 1, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await expect(
      deliver(
        "court.copy.transition",
        transitionMsg("cp1", "fee_paid", 1, { paymentRef: "CHALLAN-1", receiptMinor: 1000 }),
      ),
    ).rejects.toThrow(/RECEIPT_AMOUNT_MISMATCH/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a fee_paid transition with a malformed receiptMinor (poison message)", async () => {
    currentCopy = { status: "requested", version: 1, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await expect(
      deliver(
        "court.copy.transition",
        transitionMsg("cp1", "fee_paid", 1, { paymentRef: "CHALLAN-1", receiptMinor: "-5" }),
      ),
    ).rejects.toThrow(/INVALID_RECEIPT_AMOUNT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("issuing a prepared copy stamps issuedBy/issuedAt and deliveryMode", async () => {
    currentCopy = { status: "prepared", version: 4, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await deliver("court.copy.transition", transitionMsg("cp1", "issued", 4, { deliveryMode: "post" }));
    const args = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { set: Record<string, unknown> };
    expect(args.set.status).toBe("issued");
    expect(args.set.issuedBy).toBeTruthy();
    expect(args.set.issuedAt).toBeInstanceOf(Date);
    expect(args.set.deliveryMode).toBe("post");
  });

  it("rejects an illegal transition (requested → issued)", async () => {
    currentCopy = { status: "requested", version: 1, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await expect(deliver("court.copy.transition", transitionMsg("cp1", "issued", 1)))
      .rejects.toThrow(/INVALID_COPY_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token", async () => {
    currentCopy = { status: "requested", version: 5, feeMinor: 1500n };
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    await expect(
      deliver(
        "court.copy.transition",
        transitionMsg("cp1", "fee_paid", 1, { paymentRef: "CHALLAN-1", receiptMinor: 1500 }),
      ),
    ).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown copy and is a no-op when already at target", async () => {
    const { register, deliver } = makeHarness();
    registerCertifiedCopyConsumers(register);
    currentCopy = undefined;
    await expect(
      deliver(
        "court.copy.transition",
        transitionMsg("nope", "fee_paid", 1, { paymentRef: "CHALLAN-1", receiptMinor: 1500 }),
      ),
    ).rejects.toThrow(/COPY_NOT_FOUND/);
    currentCopy = { status: "fee_paid", version: 2, feeMinor: 1500n };
    await deliver(
      "court.copy.transition",
      transitionMsg("cp1", "fee_paid", 2, { paymentRef: "CHALLAN-1", receiptMinor: 1500 }),
    );
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
