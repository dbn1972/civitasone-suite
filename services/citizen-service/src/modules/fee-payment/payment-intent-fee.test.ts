/**
 * V4-G-02 -- the fee on an online payment intent must be derived from the SERVER-SIDE application
 * (its owner, service, schedule and the data captured on its draft), never from caller-supplied
 * subject / citizenId / serviceId. Otherwise a citizen posts {subject:{category:"BPL"}} and waives
 * their own fee.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

type Handler = (msg: unknown) => Promise<void>;
class TestMemoryQueue {
  handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: Record<string, unknown>): Promise<string> {
    const msg = {
      messageId: (input.messageId as string) ?? randomUUID(),
      type: (input.type as string) ?? topic,
      tenantId: input.tenantId as string,
      actorId: input.actorId as string,
      correlationId: input.correlationId as string,
      timestamp: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: input.payload,
    };
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }
}

const m = vi.hoisted(() => ({
  queue: null as unknown,
  insertPayment: vi.fn(async () => undefined),
  findScheduleByIdTx: vi.fn(),
  findActiveScheduleForService: vi.fn(),
  findDraftFormDataByApplicationTx: vi.fn(),
  findApplicationByIdTx: vi.fn(),
  findApplicationById: vi.fn(),
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
}));
vi.mock("../../shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), put: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
  get queue() { return m.queue; },
}));
vi.mock("../../shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));
vi.mock("./repo.js", () => ({
  insertPayment: m.insertPayment,
  findScheduleByIdTx: m.findScheduleByIdTx,
  findActiveScheduleForService: m.findActiveScheduleForService,
  findDraftFormDataByApplicationTx: m.findDraftFormDataByApplicationTx,
}));
vi.mock("../application/repo.js", () => ({
  findApplicationByIdTx: m.findApplicationByIdTx,
  findApplicationById: m.findApplicationById,
}));
vi.mock("../catalogue/repo.js", () => ({ findPublishedByServiceIdTx: vi.fn() }));
vi.mock("../catalogue/notification-bindings.js", () => ({
  enqueuePackNotifications: vi.fn(async () => undefined),
  formatAmountMajor: (a: number) => String(a),
}));

import { registerFeePaymentConsumers } from "./consumer.js";
import { createPaymentIntent } from "./commands.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const OWNER = "20000000-bbbb-4000-8000-000000000001";
const OTHER = "20000000-bbbb-4000-8000-000000000002";
const APP_ID = "40000000-dddd-4000-8000-000000000001";
const SERVICE_ID = "60000000-ffff-4000-8000-000000000001";
const OTHER_SERVICE = "60000000-ffff-4000-8000-000000000002";
const SCHEDULE_ID = "50000000-eeee-4000-8000-000000000001";
const BPL_WAIVE = { id: "bpl", attribute: "category", op: "eq", value: "BPL", kind: "waive" };
const schedule = (serviceId = SERVICE_ID) => ({
  id: SCHEDULE_ID, serviceId, baseAmount: 500000, currency: "INR", exemptions: [BPL_WAIVE],
});
const application = { id: APP_ID, tenantId: TENANT, citizenId: OWNER, serviceId: SERVICE_ID };
const ctx = (actorId: string, roles: string[]) => ({
  tenantId: TENANT, actorId, actorType: "user" as const, correlationId: randomUUID(), roles,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.markProcessed.mockResolvedValue(true);
  m.findApplicationByIdTx.mockResolvedValue(application);
  m.findApplicationById.mockResolvedValue(application);
  m.findScheduleByIdTx.mockResolvedValue(schedule());
  m.findActiveScheduleForService.mockResolvedValue(schedule());
  m.findDraftFormDataByApplicationTx.mockResolvedValue({});
});

describe("V4-G-02 payment intent consumer derives the fee server-side", () => {
  it("ignores a forged subject / citizenId / serviceId in the command payload", async () => {
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(COMMANDS.paymentIntentCreate, {
      tenantId: TENANT, actorId: OWNER, correlationId: randomUUID(),
      payload: {
        id: randomUUID(), tenantId: TENANT, applicationId: APP_ID, scheduleId: SCHEDULE_ID,
        serviceId: OTHER_SERVICE, citizenId: OTHER, subject: { category: "BPL" },
      },
    });
    expect(m.insertPayment).toHaveBeenCalledTimes(1);
    const row = (m.insertPayment.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(row.amount).toBe(500000);
    expect(row.exemptionApplied).toBeNull();
    expect(row.citizenId).toBe(OWNER);
  });

  it("still applies an exemption that the server-side application data qualifies for", async () => {
    m.findDraftFormDataByApplicationTx.mockResolvedValue({ category: "BPL" });
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(COMMANDS.paymentIntentCreate, {
      tenantId: TENANT, actorId: OWNER, correlationId: randomUUID(),
      payload: { id: randomUUID(), tenantId: TENANT, applicationId: APP_ID, scheduleId: SCHEDULE_ID, subject: {} },
    });
    const row = (m.insertPayment.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(row.amount).toBe(0);
    expect(row.exemptionApplied).toBe("bpl");
  });

  it("creates no payment when the application does not exist", async () => {
    m.findApplicationByIdTx.mockResolvedValue(null);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(COMMANDS.paymentIntentCreate, {
      tenantId: TENANT, actorId: OWNER, correlationId: randomUUID(),
      payload: { id: randomUUID(), tenantId: TENANT, applicationId: APP_ID, scheduleId: SCHEDULE_ID, subject: { category: "BPL" } },
    });
    expect(m.insertPayment).not.toHaveBeenCalled();
  });

  it("creates no payment when the schedule belongs to a different service than the application", async () => {
    m.findScheduleByIdTx.mockResolvedValue(schedule(OTHER_SERVICE));
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(COMMANDS.paymentIntentCreate, {
      tenantId: TENANT, actorId: OWNER, correlationId: randomUUID(),
      payload: { id: randomUUID(), tenantId: TENANT, applicationId: APP_ID, scheduleId: SCHEDULE_ID, subject: {} },
    });
    expect(m.insertPayment).not.toHaveBeenCalled();
  });
});

describe("V4-G-02 createPaymentIntent command binds the intent to the callers own application", () => {
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  beforeEach(() => {
    published.length = 0;
    m.queue = { publish: async (type: string, msg: { payload: Record<string, unknown> }) => { published.push({ type, payload: msg.payload }); } };
  });
  const body = { applicationId: APP_ID, scheduleId: SCHEDULE_ID, subject: { category: "BPL" } };

  it("publishes the application's real citizen/service and drops the caller subject", async () => {
    await createPaymentIntent(ctx(OWNER, ["citizen"]), { ...body, citizenId: OWNER });
    expect(published).toHaveLength(1);
    expect(published[0]!.payload).toMatchObject({ applicationId: APP_ID, citizenId: OWNER, serviceId: SERVICE_ID, subject: {} });
  });

  it("404s a citizen who does not own the application", async () => {
    await expect(createPaymentIntent(ctx(OTHER, ["citizen"]), body)).rejects.toMatchObject({ status: 404 });
    expect(published).toHaveLength(0);
  });

  it("404s an unknown application and a foreign-tenant application", async () => {
    m.findApplicationById.mockResolvedValue(null);
    await expect(createPaymentIntent(ctx(OWNER, ["citizen"]), body)).rejects.toMatchObject({ status: 404 });
    m.findApplicationById.mockResolvedValue({ ...application, tenantId: randomUUID() });
    await expect(createPaymentIntent(ctx(OWNER, ["citizen"]), body)).rejects.toMatchObject({ status: 404 });
    expect(published).toHaveLength(0);
  });

  it("rejects a schedule or service that does not belong to the application's service", async () => {
    m.findScheduleByIdTx.mockResolvedValue(schedule(OTHER_SERVICE));
    await expect(createPaymentIntent(ctx(OWNER, ["citizen"]), body)).rejects.toMatchObject({ status: 422 });
    await expect(
      createPaymentIntent(ctx(OWNER, ["citizen"]), { applicationId: APP_ID, serviceId: OTHER_SERVICE, subject: {} }),
    ).rejects.toMatchObject({ status: 422 });
    expect(published).toHaveLength(0);
  });
});
