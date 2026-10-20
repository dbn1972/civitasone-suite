/**
 * GAP-VISITOR-ADMIN-02 -- config writes emit a `config.changed` audit event with
 * redacted before/after values, and a stale expectedVersion is rejected by the
 * consumer (VERSION_CONFLICT, non-retryable, no write, no audit).
 * Mocked-persistence unit test: the consumer's decisions are what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetryableError } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async (..._a: unknown[]) => undefined);
const versionedUpdateMock = vi.fn(async (..._a: unknown[]) => undefined);
const getForUpdateMock = vi.fn();
const insertMock = vi.fn(async (..._a: unknown[]) => undefined);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const CONFIG_ID = "33333333-3333-3333-3333-333333333333";

vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (fn: (tx: object) => unknown) => fn({}) } }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidateResourceAfterCommit: vi.fn(async () => undefined) } }));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...(a as [])),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
  versionedUpdate: (...a: unknown[]) => versionedUpdateMock(...a),
}));
vi.mock("../src/modules/config-registry/repo.js", () => ({
  getConfigForUpdate: (...a: unknown[]) => getForUpdateMock(...a),
  insertConfig: (...a: unknown[]) => insertMock(...a),
  isUniqueViolation: () => false,
}));

const { registerConfigRegistryConsumers } = await import("../src/modules/config-registry/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

type H = (msg: unknown) => Promise<void>;
const handlers = new Map<string, H>();
registerConfigRegistryConsumers({ subscribe: (t: string, h: H) => { handlers.set(t, h); } } as never);

const env = (payload: unknown) => ({
  messageId: "m-1", type: "t", tenantId: TENANT, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0", payload,
});
const auditCalls = () => enqueueMock.mock.calls.filter((c) => (c[1] as { topic: string }).topic === "audit.event.record");
const row = (over: object = {}) => ({
  version: 3, active: true, namespace: "visitor_policy", configKey: "retention.pii_days",
  value: 30, label: null, description: null, sortOrder: 0, effectiveFrom: null, effectiveTo: null, ...over,
});
const setPayload = (over: object = {}) => ({
  id: CONFIG_ID, tenantId: TENANT, namespace: "visitor_policy", configKey: "retention.pii_days", value: 90, ...over,
});

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockClear();
  versionedUpdateMock.mockClear();
  insertMock.mockClear();
  getForUpdateMock.mockReset();
});

describe("setConfig consumer -> config.changed audit (ADMIN-02)", () => {
  it("update: audit carries action config.changed with before (v3, 30) and after (v4, 90) and the reason", async () => {
    getForUpdateMock.mockResolvedValue(row());
    await handlers.get(COMMANDS.setConfig)!(env(setPayload({ expectedVersion: 3, reason: "DPDP review" })));
    const audits = auditCalls();
    expect(audits).toHaveLength(1);
    const a = (audits[0]![1] as { payload: Record<string, any> }).payload;
    expect(a.action).toBe("config.changed");
    expect(a.resourceId).toBe(CONFIG_ID);
    expect(a.namespace).toBe("visitor_policy");
    expect(a.reason).toBe("DPDP review");
    expect(a.oldValue).toMatchObject({ configKey: "retention.pii_days", value: 30, version: 3, active: true });
    expect(a.newValue).toMatchObject({ configKey: "retention.pii_days", value: 90, version: 4, active: true });
  });

  it("create: audit has oldValue null and newValue v1", async () => {
    getForUpdateMock.mockResolvedValue(undefined);
    await handlers.get(COMMANDS.setConfig)!(env(setPayload()));
    const a = (auditCalls()[0]![1] as { payload: Record<string, any> }).payload;
    expect(a.action).toBe("config.changed");
    expect(a.oldValue).toBeNull();
    expect(a.newValue).toMatchObject({ value: 90, version: 1 });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("does not leak secrets: secret-named keys and nested secret fields are masked in before AND after", async () => {
    const s = "not-a-real-" + globalThis.crypto.randomUUID();
    getForUpdateMock.mockResolvedValue(row({ configKey: "smtp.api_key", value: s }));
    await handlers.get(COMMANDS.setConfig)!(env(setPayload({ configKey: "smtp.api_key", value: s })));
    getForUpdateMock.mockResolvedValue(row({ value: { endpoint: "https://x.example", clientSecret: s, nested: { password: s } } }));
    await handlers.get(COMMANDS.setConfig)!(env(setPayload({ value: { endpoint: "https://y.example", clientSecret: s, nested: { password: s } } })));
    const dump = JSON.stringify(auditCalls().map((c) => (c[1] as { payload: unknown }).payload));
    expect(dump).not.toContain(s);
    expect(dump).toContain("[REDACTED]");
    expect(dump).toContain("https://x.example"); // non-sensitive fields still audited
    expect(dump).toContain("https://y.example");
  });

  it("stale expectedVersion: VERSION_CONFLICT, non-retryable, no write, no audit, no event", async () => {
    getForUpdateMock.mockResolvedValue(row({ version: 5 }));
    const p = handlers.get(COMMANDS.setConfig)!(env(setPayload({ expectedVersion: 3 })));
    await expect(p).rejects.toBeInstanceOf(NonRetryableError);
    await expect(handlers.get(COMMANDS.setConfig)!(env(setPayload({ expectedVersion: 3 })))).rejects.toThrow(/VERSION_CONFLICT.*expected v3, found v5/);
    expect(versionedUpdateMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("deactivateConfig consumer -> config.changed audit (ADMIN-02)", () => {
  it("emits config.changed with active true -> false and version bump", async () => {
    getForUpdateMock.mockResolvedValue(row());
    await handlers.get(COMMANDS.deactivateConfig)!(env({ configId: CONFIG_ID, tenantId: TENANT, expectedVersion: 3 }));
    const a = (auditCalls()[0]![1] as { payload: Record<string, any> }).payload;
    expect(a.action).toBe("config.changed");
    expect(a.oldValue).toMatchObject({ active: true, version: 3 });
    expect(a.newValue).toMatchObject({ active: false, version: 4 });
  });

  it("stale expectedVersion: VERSION_CONFLICT, non-retryable, nothing written", async () => {
    getForUpdateMock.mockResolvedValue(row({ version: 9 }));
    const p = handlers.get(COMMANDS.deactivateConfig)!(env({ configId: CONFIG_ID, tenantId: TENANT, expectedVersion: 3 }));
    await expect(p).rejects.toBeInstanceOf(NonRetryableError);
    expect(versionedUpdateMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
