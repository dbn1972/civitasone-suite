/**
 * GAP-PAYROLL-DISBURSEMENT-04: the operator's reason for changing the DSC
 * signing key or the sponsor bank account must land on the audit event the
 * consumer writes. Consumers are driven directly with a fake queue; the DB
 * transaction and outbox are mocked so this asserts exactly what is audited.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueueMock = vi.fn();
const existingDsc = { subjectCn: "CN=Old", serialNumber: "SN-OLD" };

vi.mock("../src/shared/db.js", () => {
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [existingDsc] }) }) }),
    delete: () => ({ where: async () => undefined }),
  };
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { makeKey: (...a: string[]) => a.join(":"), invalidate: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  markProcessed: vi.fn(async () => true),
}));

import { registerDscConfigConsumers } from "../src/modules/dsc-config/consumer.js";
import { registerSponsorConfigConsumers } from "../src/modules/sponsor-config/consumer.js";
import { COMMANDS } from "../src/topics.js";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers: Record<string, Handler> = {};
const fakeQueue = { subscribe: (topic: string, h: Handler) => { handlers[topic] = h; } };
registerDscConfigConsumers(fakeQueue as never);
registerSponsorConfigConsumers(fakeQueue as never);

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000aa";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-0000000000aa";

function msg(type: string, payload: Record<string, unknown>) {
  return { messageId: `m-${Math.random()}`, type, tenantId: TENANT, actorId: ACTOR, correlationId: "c-1", payload };
}

function auditDetail(): Record<string, unknown> {
  const call = enqueueMock.mock.calls.find(([, m]) => (m as { topic: string }).topic === "audit.event.record");
  expect(call).toBeDefined();
  return ((call as unknown[])[1] as { payload: { detail: Record<string, unknown> } }).payload.detail;
}

describe("config consumers record the operator's reason on the audit event", () => {
  beforeEach(() => enqueueMock.mockReset());

  it("DSC upload/replace", async () => {
    await handlers[COMMANDS.dscConfigUpsert](msg(COMMANDS.dscConfigUpsert, {
      id: "x", tenantId: TENANT, storageRef: "dsc/t/signing.p12", passphrase: "secret",
      subjectCn: "CN=New", serialNumber: "SN1", notBefore: "2026-01-01T00:00:00Z",
      notAfter: "2028-01-01T00:00:00Z", sha256Fingerprint: "ff", reason: "Annual renewal per IT cell",
    }));
    const detail = auditDetail();
    expect(detail.reason).toBe("Annual renewal per IT cell");
    // The keystore passphrase must never be copied into the audit trail.
    expect(JSON.stringify(detail)).not.toContain("secret");
  });

  it("DSC removal", async () => {
    await handlers[COMMANDS.dscConfigRemove](msg(COMMANDS.dscConfigRemove, {
      id: "x", tenantId: TENANT, reason: "Key compromised, revoked by CA",
    }));
    expect(auditDetail()).toMatchObject({ subjectCN: "CN=Old", reason: "Key compromised, revoked by CA" });
  });

  it("sponsor bank change records reason and only the account's last 4", async () => {
    await handlers[COMMANDS.sponsorConfigUpsert](msg(COMMANDS.sponsorConfigUpsert, {
      id: "x", tenantId: TENANT, sponsorCode: "HDFC", sponsorIfsc: "HDFC0001234",
      sponsorAccount: "123456789012", settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: false,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: "1000000000", reason: "Treasury moved salary account",
    }));
    const detail = auditDetail();
    expect(detail).toMatchObject({ reason: "Treasury moved salary account", sponsorAccountLast4: "9012" });
    expect(JSON.stringify(detail)).not.toContain("123456789012");
  });
});
