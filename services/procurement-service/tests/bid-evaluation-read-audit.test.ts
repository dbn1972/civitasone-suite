/**
 * GAP-PROCUREMENT-BID-EVALUATION-06: the bid-evaluation register exposes
 * sealed-bid material (scores, bidder names), so every read must leave an
 * audit event -- and must fail closed: if the event cannot be recorded, no bid
 * data is released.
 *
 * Pins, against the real DB + real routes:
 *   - one `audit.event.record` per successful read, carrying actor, tenant, the
 *     route, row counts and the page window -- and NO bid content;
 *   - a caller who fails the role gate is refused and leaves no audit event;
 *   - when the audit publish fails the response is a server error with no bid data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { procurementTenders, procurementTenderBids } from "../src/modules/tender/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "9a900000-1111-4000-8000-00000000b1a1";
const ACTOR = "9a900000-2222-4000-8000-00000000b1a2";
const SEALED_BIDDER = "Sealed Audit Bidder";
const OPEN_BIDDER = "Opened Audit Bidder";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-bid-audit" }, SECRET, 3600);
}

let app: FastifyInstance;

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
}

async function seed(): Promise<void> {
  const sealedTenderId = randomUUID();
  const openTenderId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values([
      { id: sealedTenderId, tenantId: TENANT, tenderNo: "TND-AUD-SEALED", title: "Sealed", type: "open", bidClosingDate: "2026-06-01", status: "technical_evaluation", createdBy: ACTOR, updatedBy: ACTOR },
      { id: openTenderId, tenantId: TENANT, tenderNo: "TND-AUD-OPEN", title: "Opened", type: "open", bidClosingDate: "2026-06-01", status: "financial_evaluation", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(procurementTenderBids).values([
      { id: randomUUID(), tenderId: sealedTenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: SEALED_BIDDER, technicalScore: 80, financialScore: 70, financialOpened: false, rank: 1, status: "technically_qualified", createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenderId: openTenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: OPEN_BIDDER, technicalScore: 90, financialScore: 60, financialOpened: true, rank: 1, status: "evaluated", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await seed();
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

type PublishCall = [string, { messageId: string; tenantId: string; actorId: string; payload: Record<string, unknown> }];
const auditCalls = (spy: { mock: { calls: unknown[][] } }): PublishCall[] =>
  (spy.mock.calls as unknown as PublishCall[]).filter(([topic]) => topic === "audit.event.record");

describe("GET /v1/procurement/bid-evaluations -- read audit (GAP-PROCUREMENT-BID-EVALUATION-06)", () => {
  it("records exactly one audit event per read, with actor, tenant, counts and no bid content", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/bid-evaluations?limit=10&offset=0",
      headers: { authorization: `Bearer ${token(["procurement_admin"])}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);

    const calls = auditCalls(spy);
    expect(calls).toHaveLength(1);
    const [, msg] = calls[0]!;
    expect(msg.tenantId).toBe(TENANT);
    expect(msg.actorId).toBe(ACTOR);
    expect(typeof msg.messageId).toBe("string");
    expect(msg.payload).toMatchObject({
      service: "procurement",
      action: "bid_evaluations_view",
      resourceType: "bid_evaluation_register",
      outcome: "success",
      details: { route: "/v1/procurement/bid-evaluations", resultCount: 2, total: 2, limit: 10, offset: 0, financialRevealedCount: 1 },
    });
    // The audit trail must not become a second copy of the sealed data.
    const serialised = JSON.stringify(msg);
    expect(serialised).not.toContain(SEALED_BIDDER);
    expect(serialised).not.toContain(OPEN_BIDDER);
    expect(serialised).not.toMatch(/technicalScore|financialScore|totalScore/);
  });

  it("audits each read separately (two reads, two events with distinct ids)", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const headers = { authorization: `Bearer ${token(["procurement_officer"])}` };
    await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers });
    await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers });
    const ids = auditCalls(spy).map(([, m]) => m.messageId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses a caller outside the role gate and records no audit event", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/bid-evaluations",
      headers: { authorization: `Bearer ${token(["workflow_user"])}` },
    });
    expect(res.statusCode).toBe(403);
    expect(auditCalls(spy)).toHaveLength(0);
    expect(res.body).not.toContain(SEALED_BIDDER);
  });

  it("fails closed: when the audit event cannot be recorded, no bid data is returned", async () => {
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("queue down"));
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/bid-evaluations",
      headers: { authorization: `Bearer ${token(["procurement_admin"])}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("AUDIT_UNAVAILABLE");
    expect(res.body).not.toContain(SEALED_BIDDER);
    expect(res.body).not.toContain(OPEN_BIDDER);
    expect(res.body).not.toContain("queue down");
  });
});
