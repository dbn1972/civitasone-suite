/**
 * Tender / RFP tracking tests (KA-003).
 * Covers the bid-stage state machine (invalid + terminal → 422), the mandatory
 * loss reason (400), and exact bigint money round-tripping above 2^53.
 *
 * Writes are CQRS: the route validates and returns 202 Accepted, and the
 * consumer applies the row. Every mutating helper therefore drains the queue
 * before returning, and state is asserted through the read path rather than
 * from the command response.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { EVENTS } from "../src/topics.js";
import { drainQueue } from "./consumer-harness.js";
import {
  canTransition,
  isTerminalStage,
  isBidStage,
  allowedNextStages,
  isValidLossReason,
  requiresLossReason,
} from "../src/modules/deals/tender-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000060";
const ACTOR = "cccccccc-3333-4000-8000-000000000060";
const ACCOUNT = "dddddddd-4444-4000-8000-000000000060";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000060";

/** 9_007_199_254_740_993 = 2^53 + 1 — unrepresentable as an exact JS number. */
const ABOVE_2_53 = "9007199254740993";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-tender" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.tenders WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

async function createTender(payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/tenders", headers: headers(), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function moveStage(id: string, payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `/v1/crm/tenders/${id}/stage`,
    headers: headers(),
    payload,
  });
  await app.close();
  await drainQueue();
  return res;
}

async function patchTender(id: string, payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/crm/tenders/${id}`,
    headers: headers(),
    payload,
  });
  await app.close();
  await drainQueue();
  return res;
}

/** Read a tender back through the real list route, after the consumer applied. */
async function fetchTender(id: string): Promise<Record<string, string | number>> {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/crm/tenders?limit=200", headers: headers() });
  await app.close();
  const row = res.json().data.find((t: { id: string }) => t.id === id);
  expect(row, `tender ${id} was never applied by the consumer`).toBeDefined();
  return row;
}

/** Stage-change events carry the transition; the row only carries the result. */
async function stageEvents(id: string): Promise<Array<{ fromStage: string; toStage: string }>> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = ${EVENTS.tenderStageChanged}
        AND payload->>'tenderId' = ${id}
      ORDER BY created_at
    `;
  }) as unknown as Array<{ payload: { fromStage: string; toStage: string } }>;
  return rows.map((r) => ({ fromStage: r.payload.fromStage, toStage: r.payload.toStage }));
}

describe("tender-domain (pure)", () => {
  it("walks the happy path", () => {
    expect(canTransition("identified", "qualified")).toBe(true);
    expect(canTransition("qualified", "bid_prepared")).toBe(true);
    expect(canTransition("bid_prepared", "submitted")).toBe(true);
    expect(canTransition("submitted", "won")).toBe(true);
    expect(canTransition("submitted", "lost")).toBe(true);
  });

  it("rejects stage skipping and backwards moves", () => {
    expect(canTransition("identified", "submitted")).toBe(false);
    expect(canTransition("submitted", "qualified")).toBe(false);
    expect(canTransition("qualified", "identified")).toBe(false);
  });

  it("treats won and lost as terminal", () => {
    expect(isTerminalStage("won")).toBe(true);
    expect(isTerminalStage("lost")).toBe(true);
    expect(isTerminalStage("submitted")).toBe(false);
    expect(allowedNextStages("won")).toHaveLength(0);
    expect(allowedNextStages("identified")).toEqual(["qualified"]);
  });

  it("recognises valid stage names only", () => {
    expect(isBidStage("qualified")).toBe(true);
    expect(isBidStage("archived")).toBe(false);
  });

  it("requires a substantive loss reason", () => {
    expect(requiresLossReason("lost")).toBe(true);
    expect(requiresLossReason("won")).toBe(false);
    expect(isValidLossReason("too short")).toBe(false);
    expect(isValidLossReason("   ")).toBe(false);
    expect(isValidLossReason(null)).toBe(false);
    expect(isValidLossReason("Price was 20% above the L1 bidder")).toBe(true);
  });
});

describe("POST /v1/crm/tenders", () => {
  it("registers a tender → 202, applied as identified", async () => {
    const res = await createTender({
      accountId: ACCOUNT,
      tenderRef: "T-2026-001",
      title: "Municipal ERP rollout",
      estimatedValueMinor: "250000000",
      competitors: ["Acme", "Globex"],
    });
    expect(res.statusCode).toBe(202);
    const row = await fetchTender(res.json().id);
    expect(row.bidStage).toBe("identified");
    expect(row.estimatedValueMinor).toBe("250000000");
    expect(typeof row.estimatedValueMinor).toBe("string");
    expect(row.currency).toBe("INR");
  });

  it("round-trips a value above 2^53 exactly as a string", async () => {
    const created = await createTender({
      tenderRef: "T-2026-BIG",
      title: "Nationwide fibre",
      estimatedValueMinor: ABOVE_2_53,
    });
    expect(created.statusCode).toBe(202);
    expect((await fetchTender(created.json().id)).estimatedValueMinor).toBe(ABOVE_2_53);

    const app = await buildApp();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/crm/tenders?limit=50",
      headers: headers(),
    });
    await app.close();

    const row = listed.json().data.find((t: { tenderRef: string }) => t.tenderRef === "T-2026-BIG");
    expect(row.estimatedValueMinor).toBe(ABOVE_2_53);
    // The exactness proof: parsing as a float would yield ...992.
    expect(BigInt(row.estimatedValueMinor)).toBe(BigInt(ABOVE_2_53));
    expect(Number(row.estimatedValueMinor).toString()).not.toBe(ABOVE_2_53);
  });

  it("rejects a duplicate tenderRef → 409", async () => {
    const res = await createTender({ tenderRef: "T-2026-001", title: "Duplicate" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TENDER_EXISTS");
  });

  it("rejects a float money value → 400", async () => {
    const res = await createTender({
      tenderRef: "T-2026-FLOAT",
      title: "Bad money",
      estimatedValueMinor: "1000.50",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing title → 400", async () => {
    const res = await createTender({ tenderRef: "T-2026-NO-TITLE" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/tenders",
      payload: { tenderRef: "T-401", title: "No auth" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/tenders",
      headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
      payload: { tenderRef: "T-403", title: "Forbidden" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/tenders", () => {
  it("returns the list envelope with meta", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/tenders", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta.page).toBe(1);
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by stage and accountId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/tenders?stage=identified&accountId=${ACCOUNT}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.bidStage).toBe("identified");
      expect(row.accountId).toBe(ACCOUNT);
    }
  });

  it("clamps an over-large limit → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/tenders?limit=5000", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/tenders" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/tenders/upcoming", () => {
  it("lists tenders with deadlines inside the window", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await createTender({ tenderRef: "T-2026-SOON", title: "Closing soon", submissionDeadline: soon });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/tenders/upcoming?withinDays=7",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const refs = res.json().data.map((t: { tenderRef: string }) => t.tenderRef);
    expect(refs).toContain("T-2026-SOON");
    expect(res.json().meta.withinDays).toBe(7);
  });

  it("excludes deadlines beyond the window", async () => {
    const far = new Date(Date.now() + 90 * 86_400_000).toISOString();
    await createTender({ tenderRef: "T-2026-FAR", title: "Closing later", submissionDeadline: far });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/tenders/upcoming?withinDays=7",
      headers: headers(),
    });
    await app.close();

    const refs = res.json().data.map((t: { tenderRef: string }) => t.tenderRef);
    expect(refs).not.toContain("T-2026-FAR");
  });

  it("rejects withinDays=0 → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/tenders/upcoming?withinDays=0",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/tenders/upcoming" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/crm/tenders/:id", () => {
  it("amends title and value → 202, applied with a version bump", async () => {
    const created = await createTender({ tenderRef: "T-2026-PATCH", title: "Original" });
    const id = created.json().id;

    const res = await patchTender(id, { title: "Amended", estimatedValueMinor: ABOVE_2_53, version: 1 });

    expect(res.statusCode).toBe(202);
    const row = await fetchTender(id);
    expect(row.title).toBe("Amended");
    expect(row.estimatedValueMinor).toBe(ABOVE_2_53);
    expect(row.version).toBe(2);
  });

  it("returns 409 on a stale version", async () => {
    const created = await createTender({ tenderRef: "T-2026-STALE", title: "Stale test" });
    const id = created.json().id;

    const res = await patchTender(id, { title: "Nope", version: 99 });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    // The stale write must never reach the consumer, or it would be dropped
    // silently after the caller was told the command was accepted.
    expect((await fetchTender(id)).title).toBe("Stale test");
  });

  it("rejects an empty patch → 400", async () => {
    const created = await createTender({ tenderRef: "T-2026-EMPTY", title: "Empty patch" });
    const id = created.json().id;

    const res = await patchTender(id, {});
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown tender", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/tenders/${NONEXIST}`,
      headers: headers(),
      payload: { title: "Ghost" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/tenders/${NONEXIST}`,
      payload: { title: "No auth" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/tenders/:id/stage", () => {
  it("advances one stage at a time → 202 each, applied in order", async () => {
    const created = await createTender({ tenderRef: "T-2026-FLOW", title: "Stage flow" });
    const id = created.json().id;

    const first = await moveStage(id, { toStage: "qualified" });
    expect(first.statusCode).toBe(202);
    expect((await fetchTender(id)).bidStage).toBe("qualified");

    const second = await moveStage(id, { toStage: "bid_prepared" });
    expect(second.statusCode).toBe(202);

    const third = await moveStage(id, { toStage: "submitted" });
    expect(third.statusCode).toBe(202);

    const won = await moveStage(id, { toStage: "won" });
    expect(won.statusCode).toBe(202);
    expect((await fetchTender(id)).bidStage).toBe("won");

    expect(await stageEvents(id)).toEqual([
      { fromStage: "identified", toStage: "qualified" },
      { fromStage: "qualified", toStage: "bid_prepared" },
      { fromStage: "bid_prepared", toStage: "submitted" },
      { fromStage: "submitted", toStage: "won" },
    ]);
  });

  it("rejects a skipped stage → 422", async () => {
    const created = await createTender({ tenderRef: "T-2026-SKIP", title: "Skip" });
    const id = created.json().id;

    const res = await moveStage(id, { toStage: "submitted" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
    expect((await fetchTender(id)).bidStage).toBe("identified");
  });

  it("rejects any move out of a terminal stage → 422", async () => {
    const created = await createTender({ tenderRef: "T-2026-TERM", title: "Terminal" });
    const id = created.json().id;

    await moveStage(id, { toStage: "qualified" });
    await moveStage(id, { toStage: "bid_prepared" });
    await moveStage(id, { toStage: "submitted" });
    const lost = await moveStage(id, { toStage: "lost", reason: "Undercut by the incumbent vendor" });
    expect(lost.statusCode).toBe(202);
    expect((await fetchTender(id)).bidStage).toBe("lost");

    const again = await moveStage(id, { toStage: "won" });
    expect(again.statusCode).toBe(422);
    expect(again.json().message).toContain("terminal");
  });

  it("refuses to amend a terminal tender → 422", async () => {
    const created = await createTender({ tenderRef: "T-2026-TERM-PATCH", title: "Closed" });
    const id = created.json().id;
    await moveStage(id, { toStage: "qualified" });
    await moveStage(id, { toStage: "bid_prepared" });
    await moveStage(id, { toStage: "submitted" });
    await moveStage(id, { toStage: "won" });

    const res = await patchTender(id, { title: "Too late" });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TENDER_CLOSED");
  });

  it("requires a reason of 10+ chars for lost → 400", async () => {
    const created = await createTender({ tenderRef: "T-2026-LOSTREASON", title: "Lost reason" });
    const id = created.json().id;
    await moveStage(id, { toStage: "qualified" });
    await moveStage(id, { toStage: "bid_prepared" });
    await moveStage(id, { toStage: "submitted" });

    const short = await moveStage(id, { toStage: "lost", reason: "cheap" });
    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe("REASON_REQUIRED");

    const missing = await moveStage(id, { toStage: "lost" });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("REASON_REQUIRED");
  });

  it("rejects an unknown stage name → 400", async () => {
    const created = await createTender({ tenderRef: "T-2026-BADSTAGE", title: "Bad stage" });
    const id = created.json().id;
    const res = await moveStage(id, { toStage: "archived" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown tender", async () => {
    const res = await moveStage(NONEXIST, { toStage: "qualified" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/tenders/not-a-uuid/stage",
      headers: headers(),
      payload: { toStage: "qualified" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/tenders/${NONEXIST}/stage`,
      payload: { toStage: "qualified" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/tenders/${NONEXIST}/stage`,
      headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
      payload: { toStage: "qualified" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
