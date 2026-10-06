/**
 * GAP-TENANT-ADMIN-SECURITY-04: the security-events export consumer turns the
 * admin.security_events.export_recorded command into a security_events.exported
 * audit outbox row. This test does NOT build the Fastify app, so it is not
 * affected by an unrelated, concurrently-introduced duplicate-route collision
 * (/v1/admin/compliance) that currently blocks buildApp() in this worktree.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));

const enqueueMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));

import { registerSecurityExportConsumers } from "../src/modules/security-export/consumer.js";

const TENANT = "aaaaaaaa-0002-4000-8000-0000000000c3";

describe("security export consumer", () => {
  it("writes a security_events.exported audit outbox row", async () => {
    let handler: ((m: unknown) => Promise<void>) | undefined;
    registerSecurityExportConsumers({ subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { handler = h; } } as never);
    enqueueMock.mockClear();
    await handler!({ messageId: "s1", tenantId: TENANT, actorId: "a", correlationId: "c", payload: { id: "s1", tenantId: TENANT, rowCount: 5, filtered: false } });
    const call = enqueueMock.mock.calls.find((c) => (c[1] as { topic?: string }).topic === "audit.event.record");
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ action: "security_events.exported", resourceType: "security_events" });
  });
});
