/**
 * GAP-TENANT-ADMIN-MFA-03: the MFA-status export consumer turns the
 * admin.mfa_status.export_recorded command into an mfa_status.exported audit
 * outbox row, and the command publishes that topic with the right payload.
 * GAP-TENANT-ADMIN-MFA-05: pins the real mfaStatus enum the web page must map
 * (admin-service derives it from a boolean -> "enabled" | "disabled").
 *
 * Deliberately does NOT build the Fastify app: buildApp() is currently blocked
 * in this worktree by an unrelated, concurrently-introduced duplicate
 * /v1/admin/compliance route (see security-export-consumer.test.ts for the
 * same workaround).
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

const publishMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => publishMock(...a) },
}));

import { registerMfaExportConsumers } from "../src/modules/mfa-export/consumer.js";
import { recordMfaExport } from "../src/modules/mfa-export/commands.js";
import { mfaStatusLabel } from "../src/modules/gap/routes.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-0002-4000-8000-0000000000d4";

describe("GAP-TENANT-ADMIN-MFA-03 — MFA export audit", () => {
  it("command publishes admin.mfa_status.export_recorded with rowCount + filtered", async () => {
    publishMock.mockClear();
    const r = await recordMfaExport({ tenantId: TENANT, actorId: "a", correlationId: "c" } as never, 7, true);
    expect(r.status).toBe("accepted");
    const call = publishMock.mock.calls.find((c) => c[0] === COMMANDS.mfaExportRecorded);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ rowCount: 7, filtered: true });
  });

  it("consumer writes an mfa_status.exported audit outbox row", async () => {
    let handler: ((m: unknown) => Promise<void>) | undefined;
    registerMfaExportConsumers({ subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { handler = h; } } as never);
    enqueueMock.mockClear();
    await handler!({ messageId: "x1", tenantId: TENANT, actorId: "a", correlationId: "c", payload: { id: "x1", tenantId: TENANT, rowCount: 3, filtered: false } });
    const call = enqueueMock.mock.calls.find((c) => (c[1] as { topic?: string }).topic === "audit.event.record");
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ action: "mfa_status.exported", resourceType: "mfa_status" });
  });
});

describe("GAP-TENANT-ADMIN-MFA-05 — mfaStatus enum is enabled|disabled", () => {
  it("enrolled user -> 'enabled', unenrolled -> 'disabled' (never 'active'/'pending')", () => {
    expect(mfaStatusLabel(true)).toBe("enabled");
    expect(mfaStatusLabel(false)).toBe("disabled");
  });
});
