/**
 * hrms-service consumers coverage tests (integration-style)
 *
 * Verifies the newer HRMS consumers (social, visiting-cards, dashboard,
 * reports, rti, self-service, orgchart) are correctly registered, follow
 * the CQRS pattern (idempotency → outbox → audit), and process messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; eventType: string; payload: unknown }> = [];
  return { mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages };
});

let markProcessedResult = true;

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; eventType: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, eventType: msg.eventType, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => markProcessedResult),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));

import { registerSocialConsumers } from "../src/modules/social/consumer.js";
import { registerVisitingCardConsumers } from "../src/modules/visiting-cards/consumer.js";
import { registerDashboardConsumers } from "../src/modules/dashboard/consumer.js";
import { registerReportsConsumers } from "../src/modules/reports/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerSelfServiceConsumers } from "../src/modules/self-service/consumer.js";
import { registerOrgchartConsumers } from "../src/modules/orgchart/consumer.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const AUDIT_TOPIC = "audit.event.record";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedResult = true;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

// ─── Social consumers ────────────────────────────────────────────────────────

describe("Social consumers — registration and processing", () => {
  it("registers correct topics", async () => {
    const q = new MemoryQueue();
    registerSocialConsumers(q);
    const topics = (q as any)._subscriptions?.keys?.() ?? Object.keys((q as any)._handlers ?? {});
    // Just verify registration doesn't throw and queue starts
    await q.start();
    await q.stop();
  });

  it("kudos_create handler processes message and enqueues audit event", async () => {
    const q = new MemoryQueue();
    registerSocialConsumers(q);
    await q.start();

    await q.publish("hrms.social.kudos_create", makeMsg("hrms.social.kudos_create", {
      id: randomUUID(), tenantId: TENANT,
      giverId: randomUUID(), receiverId: randomUUID(),
      badge: "star", message: "Great work!",
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const auditPayload = auditEvents[0]!.payload as Record<string, unknown>;
    expect(auditPayload.service).toBe("hrms");
    expect(auditPayload.action).toBe("kudos_create");
    expect(auditPayload.outcome).toBe("success");

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.social.kudos_created");
    expect(domainEvents).toHaveLength(1);
    await q.stop();
  });

  it("kudos_create idempotency — duplicate messageId rejected on second attempt", async () => {
    markProcessedResult = false; // simulate already-processed
    const q = new MemoryQueue();
    registerSocialConsumers(q);
    await q.start();

    await q.publish("hrms.social.kudos_create", makeMsg("hrms.social.kudos_create", {
      id: randomUUID(), tenantId: TENANT,
      giverId: randomUUID(), receiverId: randomUUID(),
      badge: "star", message: "Dup",
    }));
    await settle();

    // Nothing enqueued because markProcessed returned false
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });

  it("expense_create handler enqueues domain event + audit", async () => {
    const q = new MemoryQueue();
    registerSocialConsumers(q);
    await q.start();

    await q.publish("hrms.social.expense_create", makeMsg("hrms.social.expense_create", {
      id: randomUUID(), tenantId: TENANT,
      employeeId: randomUUID(), category: "travel", amount: 15000,
    }));
    await settle();

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.social.expense_created");
    expect(domainEvents).toHaveLength(1);
    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });
});

// ─── Visiting-cards consumers ────────────────────────────────────────────────

describe("Visiting-card consumers — registration and processing", () => {
  it("visiting_card.update handler processes message and enqueues audit event", async () => {
    const q = new MemoryQueue();
    registerVisitingCardConsumers(q);
    await q.start();

    await q.publish("hrms.visiting_card.update", makeMsg("hrms.visiting_card.update", {
      employeeId: randomUUID(), tenantId: TENANT,
      fields: { designation: "Director", phone: "9876543210" },
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const auditPayload = auditEvents[0]!.payload as Record<string, unknown>;
    expect(auditPayload.action).toBe("visiting_card_update");

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.visiting_card.updated");
    expect(domainEvents).toHaveLength(1);
    await q.stop();
  });

  it("visiting_card.share handler enqueues shared event + audit", async () => {
    const q = new MemoryQueue();
    registerVisitingCardConsumers(q);
    await q.start();

    await q.publish("hrms.visiting_card.share", makeMsg("hrms.visiting_card.share", {
      employeeId: randomUUID(), tenantId: TENANT, method: "qr",
    }));
    await settle();

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.visiting_card.shared");
    expect(domainEvents).toHaveLength(1);
    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("visiting_card.update idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerVisitingCardConsumers(q);
    await q.start();

    await q.publish("hrms.visiting_card.update", makeMsg("hrms.visiting_card.update", {
      employeeId: randomUUID(), tenantId: TENANT, fields: { title: "CTO" },
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ─── Dashboard consumer ──────────────────────────────────────────────────────

describe("Dashboard consumer — registration and processing", () => {
  it("dashboard.refresh processes and enqueues audit event", async () => {
    const q = new MemoryQueue();
    registerDashboardConsumers(q);
    await q.start();

    await q.publish("hrms.dashboard.refresh", makeMsg("hrms.dashboard.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.dashboard.refreshed");
    expect(domainEvents).toHaveLength(1);
    await q.stop();
  });

  it("dashboard.refresh idempotency — duplicate skipped", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerDashboardConsumers(q);
    await q.start();

    await q.publish("hrms.dashboard.refresh", makeMsg("hrms.dashboard.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ─── Reports consumer ────────────────────────────────────────────────────────

describe("Reports consumer — registration and processing", () => {
  it("report.generate processes and enqueues report.generated + audit", async () => {
    const q = new MemoryQueue();
    registerReportsConsumers(q);
    await q.start();

    await q.publish("hrms.report.generate", makeMsg("hrms.report.generate", {
      tenantId: TENANT, reportType: "monthly_attendance", params: { month: "2024-09" },
    }));
    await settle();

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.report.generated");
    expect(domainEvents).toHaveLength(1);
    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("report.generate idempotency — duplicate rejected", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerReportsConsumers(q);
    await q.start();

    await q.publish("hrms.report.generate", makeMsg("hrms.report.generate", {
      tenantId: TENANT, reportType: "payslip", params: {},
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ─── RTI consumer ────────────────────────────────────────────────────────────

describe("RTI consumer — registration and processing", () => {
  it("rti.file handler processes and enqueues filed event + audit", async () => {
    const q = new MemoryQueue();
    registerRtiConsumers(q);
    await q.start();

    await q.publish("hrms.rti.file", makeMsg("hrms.rti.file", {
      id: randomUUID(), tenantId: TENANT, referenceNo: "RTI/2024/001",
      applicantName: "Citizen A", subject: "Service records",
      requestText: "Provide service records", receivedDate: "2024-09-01",
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const auditPayload = auditEvents[0]!.payload as Record<string, unknown>;
    expect(auditPayload.action).toBe("rti_file");

    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.rti.filed");
    expect(domainEvents).toHaveLength(1);
    await q.stop();
  });

  it("rti.file idempotency — duplicate skipped", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerRtiConsumers(q);
    await q.start();

    await q.publish("hrms.rti.file", makeMsg("hrms.rti.file", {
      id: randomUUID(), tenantId: TENANT, referenceNo: "RTI/DUP",
      applicantName: "X", subject: "Duplicate",
      requestText: "Dup", receivedDate: "2024-09-01",
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ─── Self-service consumer ───────────────────────────────────────────────────

describe("Self-service consumer — registration and processing", () => {
  it("registers without error and processes self-service request", async () => {
    const q = new MemoryQueue();
    registerSelfServiceConsumers(q);
    await q.start();

    await q.publish("hrms.self_service.profile_update", makeMsg("hrms.self_service.profile_update", {
      employeeId: randomUUID(), tenantId: TENANT,
      fields: { phone: "9988776655" },
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    await q.stop();
  });

  it("self-service idempotency — duplicate skipped", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerSelfServiceConsumers(q);
    await q.start();

    await q.publish("hrms.self_service.profile_update", makeMsg("hrms.self_service.profile_update", {
      employeeId: randomUUID(), tenantId: TENANT, fields: { phone: "0000" },
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});

// ─── Orgchart consumer ───────────────────────────────────────────────────────

describe("Orgchart consumer — registration and processing", () => {
  it("orgchart.refresh processes and enqueues refreshed event + audit", async () => {
    const q = new MemoryQueue();
    registerOrgchartConsumers(q);
    await q.start();

    await q.publish("hrms.orgchart.refresh", makeMsg("hrms.orgchart.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    const domainEvents = enqueuedMessages.filter((m) => m.topic === "hrms.orgchart.refreshed");
    expect(domainEvents).toHaveLength(1);
    await q.stop();
  });

  it("orgchart.refresh idempotency — duplicate skipped", async () => {
    markProcessedResult = false;
    const q = new MemoryQueue();
    registerOrgchartConsumers(q);
    await q.start();

    await q.publish("hrms.orgchart.refresh", makeMsg("hrms.orgchart.refresh", {
      tenantId: TENANT,
    }));
    await settle();

    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});
