/**
 * w0-report (F5) defect 2: the tenant-admin IdP table POSTed
 * /v1/admin/idp/providers/export-audit, a route that did not exist, so CSV
 * exports were never audited. Covers the command payload (actor/tenant/
 * rowCount/timestamp) and the consumer (audit outbox row; redelivery is a
 * no-op). The route is covered in idp-export-audit-route.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
const markProcessedMock = vi.fn(async (..._a: unknown[]) => true);
const enqueueMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...a),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));
const publishMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => publishMock(...a) },
}));

import { registerIdpExportConsumers } from "../src/modules/idp-export/consumer.js";
import { recordIdpExport } from "../src/modules/idp-export/commands.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-0002-4000-8000-0000000000f5";
const ACTOR = "bbbbbbbb-0002-4000-8000-0000000000f5";

describe("idp export audit — command", () => {
  beforeEach(() => publishMock.mockClear());
  it("publishes admin.idp_providers.export_recorded with actor, tenant, rowCount, filtered and an ISO timestamp", async () => {
    const r = await recordIdpExport({ tenantId: TENANT, actorId: ACTOR, correlationId: "c1" } as never, 7, true);
    expect(r.status).toBe("accepted");
    const call = publishMock.mock.calls.find((c) => c[0] === COMMANDS.idpExportRecorded)!;
    expect(call).toBeTruthy();
    const env = call[1] as { messageId: string; tenantId: string; actorId: string; payload: Record<string, unknown> };
    expect(env).toMatchObject({ tenantId: TENANT, actorId: ACTOR, messageId: r.id });
    expect(env.payload).toMatchObject({ rowCount: 7, filtered: true, tenantId: TENANT });
    expect(new Date(env.payload.exportedAt as string).toISOString()).toBe(env.payload.exportedAt);
  });
});

describe("idp export audit — consumer", () => {
  let handler: (m: unknown) => Promise<void>;
  const msg = { messageId: "m1", tenantId: TENANT, actorId: ACTOR, correlationId: "c1", payload: { id: "m1", tenantId: TENANT, rowCount: 3, filtered: false, exportedAt: "2026-10-13T00:00:00.000Z" } };
  beforeEach(() => {
    markProcessedMock.mockReset().mockResolvedValue(true);
    enqueueMock.mockClear();
    registerIdpExportConsumers({ subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { handler = h; } } as never);
  });

  it("writes one idp_providers.exported audit row with actor, tenant, rowCount and timestamp", async () => {
    await handler(msg);
    const audit = enqueueMock.mock.calls.filter((c) => (c[1] as { topic?: string }).topic === "audit.event.record");
    expect(audit).toHaveLength(1);
    const e = audit[0]![1] as { tenantId: string; actorId: string; payload: Record<string, unknown> };
    expect(e).toMatchObject({ tenantId: TENANT, actorId: ACTOR });
    expect(e.payload).toMatchObject({ action: "idp_providers.exported", resourceType: "idp_providers", rowCount: 3, exportedAt: "2026-10-13T00:00:00.000Z", outcome: "success" });
  });

  it("a redelivery (already processed) writes nothing", async () => {
    markProcessedMock.mockResolvedValue(false);
    await handler(msg);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("a failed audit write propagates so the queue redelivers (fail-closed)", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("outbox down"));
    await expect(handler(msg)).rejects.toThrow("outbox down");
  });
});
