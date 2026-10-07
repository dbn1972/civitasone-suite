/**
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02 — application timeline/history.
 *
 * Drives the real app + consumers (MemoryQueue, same wiring as worker.ts)
 * against real Postgres and asserts that every status transition appends an
 * immutable timeline event, that GET /applications/:id/history returns the
 * ordered timeline, and that the history endpoint is role-gated server-side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approvals/consumer.js";

registerApplicationConsumers(tenantScoped(queue));
registerApprovalConsumers(tenantScoped(queue));

const T1 = "aaaaaaaa-0000-4000-8000-00000000e001";
const ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ac";
const SECRET = process.env.JWT_SECRET as string;

function bearer(roles: string[] = ["trade_admin"]): { authorization: string; "x-tenant-id": string } {
  const token = signToken({ sub: ACTOR, roles, tid: T1 } as never, SECRET);
  return { authorization: `Bearer ${token}`, "x-tenant-id": T1 };
}
async function drain(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}
async function reset(): Promise<void> {
  await sqlClient`
    TRUNCATE trade.trade_application_events, trade.trade_licences, trade.licence_actions,
             trade.trade_renewals, trade.trade_scrutiny_records, trade.trade_applications,
             _outbox.messages, _inbox.processed CASCADE
  `;
}

beforeAll(reset);
afterAll(async () => { await reset(); await sqlClient.end(); });

const appBody = {
  businessName: "Timeline Traders",
  tradeCategory: "retail",
  ownerName: "T. Owner",
  premisesAddress: { line1: "1 Market Rd", city: "Pune", pin: "411001" },
};

describe("application timeline (GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02)", () => {
  it("records a create → submit → inspect → approve timeline and serves it in order", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: appBody });
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();

    await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    await drain();

    const scrutiny = await app.inject({
      method: "POST", url: "/v1/trade/approvals/scrutiny", headers: hdr,
      payload: { applicationId: appId, scrutinyType: "field_inspection", officerId: ACTOR },
    });
    const { id: scrutinyId } = JSON.parse(scrutiny.body) as { id: string };
    await drain();
    await app.inject({
      method: "POST", url: `/v1/trade/approvals/scrutiny/${scrutinyId}/complete`, headers: hdr,
      payload: { findings: { items: [{ checkItem: "premises_check", result: "pass" }] } },
    });
    await drain();

    await app.inject({
      method: "POST", url: "/v1/trade/approvals/decide", headers: hdr,
      payload: { applicationId: appId, decision: "approved", reason: "all clear" },
    });
    await drain();

    const historyRes = await app.inject({ method: "GET", url: `/v1/trade/applications/${appId}/history`, headers: hdr });
    expect(historyRes.statusCode).toBe(200);
    const events = (JSON.parse(historyRes.body) as { data: Array<{ action: string; fromStatus: string | null; toStatus: string; note: string | null }> }).data;

    const actions = events.map((e) => e.action);
    expect(actions).toEqual(["create", "submit", "inspect", "approve"]);
    // The decision event carries the officer's reason + the transition.
    const approve = events.find((e) => e.action === "approve")!;
    expect(approve.toStatus).toBe("approved");
    expect(approve.note).toBe("all clear");
    // The inspect event records the scrutiny type as its note.
    expect(events.find((e) => e.action === "inspect")!.note).toBe("field_inspection");

    await app.close();
  });

  it("records a reject decision with its reason in the timeline", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: appBody });
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();
    await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    await drain();
    // decide requires under_scrutiny — initiate scrutiny first.
    await app.inject({
      method: "POST", url: "/v1/trade/approvals/scrutiny", headers: hdr,
      payload: { applicationId: appId, scrutinyType: "document_check", officerId: ACTOR },
    });
    await drain();
    await app.inject({
      method: "POST", url: "/v1/trade/approvals/decide", headers: hdr,
      payload: { applicationId: appId, decision: "rejected", reason: "incomplete documents" },
    });
    await drain();

    const events = (JSON.parse(
      (await app.inject({ method: "GET", url: `/v1/trade/applications/${appId}/history`, headers: hdr })).body,
    ) as { data: Array<{ action: string; toStatus: string; note: string | null }> }).data;
    const reject = events.find((e) => e.action === "reject")!;
    expect(reject).toBeDefined();
    expect(reject.toStatus).toBe("rejected");
    expect(reject.note).toBe("incomplete documents");

    await app.close();
  });

  it("history endpoint 404s for an unknown application", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/trade/applications/99999999-9999-4999-8999-999999999999/history",
      headers: bearer(),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("history endpoint requires a trade role (401 without a token)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/trade/applications/99999999-9999-4999-8999-999999999999/history",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
