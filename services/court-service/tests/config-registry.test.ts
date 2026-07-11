/**
 * config-registry consumer tests — create/update idempotency, version-guarded
 * writes, and deactivation (§47). db/outbox/repo/schema/infra are mocked; the
 * REAL validators and NonRetryableError are used so the namespace/key and
 * version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentConfig: { version: number; active: boolean; namespace: string } | undefined;

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

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateResourceAfterCommit: vi.fn(async () => {}) },
}));

vi.mock("../src/modules/config-registry/schema.js", () => ({ configEntries: {} }));

vi.mock("../src/modules/config-registry/repo.js", () => ({
  insertConfig: vi.fn(async () => {}),
  getConfigForUpdate: vi.fn(async () => currentConfig),
  isUniqueViolation: (err: unknown) => {
    const code = (err as { code?: string } | null | undefined)?.code;
    return code === "23505" || code === "23P01";
  },
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { setConfig: "court.config.set", deactivateConfig: "court.config.deactivate" },
  EVENTS: { configSet: "court.config.set_done", configDeactivated: "court.config.deactivated" },
}));

import { registerConfigConsumers } from "../src/modules/config-registry/consumer.js";
import * as repo from "../src/modules/config-registry/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";
import { cache } from "../src/shared/infra.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function setMsg(
  opts: { id?: string; messageId?: string; namespace?: string; configKey?: string; expectedVersion?: number } = {},
) {
  const id = opts.id ?? randomUUID();
  return {
    messageId: opts.messageId ?? id,
    type: "court.config.set",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, tenantId: randomUUID(),
      namespace: opts.namespace ?? "court_type",
      configKey: opts.configKey ?? "district",
      value: { label: "District Court" },
      ...(opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
    },
  };
}

function deactivateMsg(configId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.config.deactivate",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { configId, tenantId: randomUUID(), expectedVersion },
  };
}

function emittedTopics() {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

describe("config-registry consumer — setConfig", () => {
  beforeEach(() => { processedIds.clear(); currentConfig = undefined; vi.clearAllMocks(); });

  it("creates a new entry and emits configSet + audit + cache invalidation", async () => {
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    currentConfig = undefined; // not-exists → create path
    await deliver("court.config.set", setMsg());
    expect(repo.insertConfig).toHaveBeenCalledTimes(1);
    expect(versionedUpdate).not.toHaveBeenCalled();
    expect(emittedTopics()).toContain("court.config.set_done");
    expect(emittedTopics()).toContain("audit.event.record");
    expect(cache.invalidateResourceAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("is exactly-once on redelivery of the same messageId", async () => {
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    const m = setMsg({ id: randomUUID(), messageId: "fixed" });
    await deliver("court.config.set", m);
    await deliver("court.config.set", m);
    expect(repo.insertConfig).toHaveBeenCalledTimes(1);
  });

  it("updates an existing entry (version-guarded) when expectedVersion matches", async () => {
    currentConfig = { version: 3, active: true, namespace: "court_type" };
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await deliver("court.config.set", setMsg({ expectedVersion: 3 }));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(repo.insertConfig).not.toHaveBeenCalled();
    expect(emittedTopics()).toContain("court.config.set_done");
  });

  it("rejects a stale optimistic-lock token with VERSION_CONFLICT", async () => {
    currentConfig = { version: 5, active: true, namespace: "court_type" };
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.set", setMsg({ expectedVersion: 1 }))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid namespace as NonRetryableError", async () => {
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.set", setMsg({ namespace: "Bad-NS" }))).rejects.toThrow(/INVALID_CONFIG_NAMESPACE/);
    expect(repo.insertConfig).not.toHaveBeenCalled();
  });

  it("rejects an invalid key as NonRetryableError", async () => {
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.set", setMsg({ configKey: "bad key" }))).rejects.toThrow(/INVALID_CONFIG_KEY/);
    expect(repo.insertConfig).not.toHaveBeenCalled();
  });

  it("maps a concurrent unique violation on create to NonRetryable CONFIG_ALREADY_EXISTS", async () => {
    currentConfig = undefined; // not-exists → create path
    (repo.insertConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }),
    );
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.set", setMsg())).rejects.toThrow(/CONFIG_ALREADY_EXISTS/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});

describe("config-registry consumer — deactivateConfig", () => {
  beforeEach(() => { processedIds.clear(); currentConfig = undefined; vi.clearAllMocks(); });

  it("deactivates an active entry (version-guarded) and emits configDeactivated", async () => {
    currentConfig = { version: 2, active: true, namespace: "court_type" };
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await deliver("court.config.deactivate", deactivateMsg("cfg1", 2));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(emittedTopics()).toContain("court.config.deactivated");
    expect(cache.invalidateResourceAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown entry with CONFIG_NOT_FOUND", async () => {
    currentConfig = undefined;
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.deactivate", deactivateMsg("nope", 1))).rejects.toThrow(/CONFIG_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when already inactive", async () => {
    currentConfig = { version: 4, active: false, namespace: "court_type" };
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await deliver("court.config.deactivate", deactivateMsg("cfg1", 4));
    expect(versionedUpdate).not.toHaveBeenCalled();
    expect(emittedTopics()).not.toContain("court.config.deactivated");
  });

  it("rejects a stale optimistic-lock token with VERSION_CONFLICT", async () => {
    currentConfig = { version: 7, active: true, namespace: "court_type" };
    const { register, deliver } = makeHarness();
    registerConfigConsumers(register);
    await expect(deliver("court.config.deactivate", deactivateMsg("cfg1", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
