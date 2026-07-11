/**
 * notice consumer tests — issue/service idempotency and version-guarded status
 * updates. db/outbox/repo/schema/topics are mocked; the REAL state machine and
 * NonRetryableError are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentNotice: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/notice/schema.js", () => ({ notices: {}, noticeService: {} }));

vi.mock("../src/modules/notice/repo.js", () => ({
  insertNotice: vi.fn(async () => {}),
  insertService: vi.fn(async () => {}),
  getNoticeForUpdate: vi.fn(async () => currentNotice),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    issueNotice: "court.notice.issue",
    recordService: "court.notice.serve",
    updateNoticeStatus: "court.notice.update_status",
  },
  EVENTS: {
    noticeIssued: "court.notice.issued",
    noticeServiceRecorded: "court.notice.service_recorded",
    noticeStatusChanged: "court.notice.status_changed",
  },
}));

import { registerNoticeConsumers } from "../src/modules/notice/consumer.js";
import * as repo from "../src/modules/notice/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function issueMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.notice.issue",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, caseId: randomUUID(), tenantId: randomUUID(), noticeType: "summons", issuedTo: "Respondent 1", issueDate: "2026-07-10" },
  };
}
function serviceMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.notice.serve",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, noticeId: randomUUID(), tenantId: randomUUID(), serviceMode: "post", recipient: "Respondent 1", deliveryStatus: "pending" },
  };
}
function statusMsg(noticeId: string, status: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.notice.update_status",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { noticeId, tenantId: randomUUID(), status, expectedVersion },
  };
}

describe("notice consumer", () => {
  beforeEach(() => { processedIds.clear(); currentNotice = undefined; vi.clearAllMocks(); });

  it("issues a notice and emits noticeIssued + audit", async () => {
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    const id = randomUUID();
    await deliver("court.notice.issue", issueMsg(id));
    expect(repo.insertNotice).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.notice.issued");
    expect(topics).toContain("audit.event.record");
  });

  it("issue is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    const m = issueMsg(randomUUID(), "fixed-issue");
    await deliver("court.notice.issue", m);
    await deliver("court.notice.issue", m);
    expect(repo.insertNotice).toHaveBeenCalledTimes(1);
  });

  it("records a service attempt and emits noticeServiceRecorded + audit", async () => {
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    await deliver("court.notice.serve", serviceMsg(randomUUID()));
    expect(repo.insertService).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.notice.service_recorded");
    expect(topics).toContain("audit.event.record");
  });

  it("service is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    const m = serviceMsg(randomUUID(), "fixed-service");
    await deliver("court.notice.serve", m);
    await deliver("court.notice.serve", m);
    expect(repo.insertService).toHaveBeenCalledTimes(1);
  });

  it("updates a notice status (version-guarded) and emits noticeStatusChanged", async () => {
    currentNotice = { status: "issued", version: 1 };
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    await deliver("court.notice.update_status", statusMsg("n1", "served", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.notice.status_changed");
  });

  it("rejects an illegal status transition", async () => {
    currentNotice = { status: "served", version: 1 };
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    await expect(deliver("court.notice.update_status", statusMsg("n1", "cancelled", 1))).rejects.toThrow(/INVALID_NOTICE_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token", async () => {
    currentNotice = { status: "issued", version: 5 };
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    await expect(deliver("court.notice.update_status", statusMsg("n1", "served", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown notice and is a no-op when already at target status", async () => {
    const { register, deliver } = makeHarness();
    registerNoticeConsumers(register);
    currentNotice = undefined;
    await expect(deliver("court.notice.update_status", statusMsg("nope", "served", 1))).rejects.toThrow(/NOTICE_NOT_FOUND/);
    currentNotice = { status: "cancelled", version: 2 };
    await deliver("court.notice.update_status", statusMsg("n1", "cancelled", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
