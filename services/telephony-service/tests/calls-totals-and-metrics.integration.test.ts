/**
 * Server-side totals for the call KPIs.
 *
 * The web derived Total / Live / Abandoned / SLA and the whole Dispositions
 * breakdown by counting the rows of ONE default page of GET /v1/telephony/calls
 * (50), so any tenant with more calls than that saw wrong, silently capped
 * numbers. The list now reports pagination.total and /calls/metrics aggregates
 * the full (optionally windowed) call set, including dispositions and SLA.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { calls } from "../src/modules/calls/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const auth = (tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["telephony_user"], sid: "s" }, SECRET)}` });

const OLD = new Date("2026-01-10T10:00:00.000Z");
let app: FastifyInstance;

type Seed = Partial<typeof calls.$inferInsert> & { status: string };
function row(tenantId: string, s: Seed): typeof calls.$inferInsert {
  return { tenantId, direction: "inbound", createdBy: ACTOR, updatedBy: ACTOR, ...s } as typeof calls.$inferInsert;
}

beforeAll(async () => {
  app = await buildApp();
  const answeredOk = { answeredAt: new Date(), waitSeconds: 5 };      // within the 20s default SLA
  const answeredLate = { answeredAt: new Date(), waitSeconds: 90 };   // SLA miss
  const seed: Seed[] = [
    // 52 completed (more than one default page of 50): 40 resolved, 10 escalated, 2 without a wrap-up code
    ...Array.from({ length: 40 }, () => ({ status: "completed", disposition: "resolved", ...answeredOk })),
    ...Array.from({ length: 10 }, () => ({ status: "completed", disposition: "escalated", ...answeredLate })),
    ...Array.from({ length: 2 }, () => ({ status: "completed", ...answeredOk })),
    // 3 live, 4 abandoned
    { status: "queued" }, { status: "ringing" }, { status: "ringing" },
    ...Array.from({ length: 4 }, () => ({ status: "abandoned" })),
  ];
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(calls).values(seed.map((s) => row(TENANT, s)));
      // an old call, outside any recent window
      await tx.insert(calls).values(row(TENANT, { status: "completed", disposition: "resolved", ...answeredOk, createdAt: OLD }));
    }),
  );
  await runWithTenant(OTHER_TENANT, () =>
    db.transaction((tx) => tx.insert(calls).values(row(OTHER_TENANT, { status: "abandoned" }))),
  );
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/telephony/calls pagination.total", () => {
  it("reports the true total, not the page length", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?limit=10", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(10);
    expect(body.pagination.total).toBe(52 + 3 + 4 + 1); // 60, tenant-scoped (other tenant excluded)
    expect(body.pagination.hasMore).toBe(true);
  });

  it("total follows the same filters as the page (status, createdAt window)", async () => {
    const abandoned = await app.inject({ method: "GET", url: "/v1/telephony/calls?status=abandoned", headers: auth() });
    expect(abandoned.json().pagination.total).toBe(4);
    const recent = await app.inject({ method: "GET", url: "/v1/telephony/calls?from=2026-02-01T00:00:00Z&limit=1", headers: auth() });
    expect(recent.json().pagination.total).toBe(59); // excludes the January call
  });

  it("hasMore is false on the last page", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?limit=50&offset=50", headers: auth() });
    expect(res.json().data).toHaveLength(10);
    expect(res.json().pagination.hasMore).toBe(false);
  });
});

describe("GET /v1/telephony/calls/metrics aggregates the whole call set", () => {
  it("returns totals, live, abandoned, SLA and the disposition breakdown over all rows", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics", headers: auth() });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.total).toBe(60);
    expect(m.live).toBe(3);
    expect(m.abandoned).toBe(4);
    expect(m.completed).toBe(53);
    // scored = answered with a wait: 40 + 10 + 2 + 1(old) = 53; met = all but the 10 late ones
    expect(m.slaScored).toBe(53);
    expect(m.slaMet).toBe(43);
    expect(m.slaPct).toBe(81);
    expect(m.dispositions).toEqual([
      { disposition: "resolved", count: 41 },
      { disposition: "escalated", count: 10 },
      { disposition: null, count: 2 },
    ]);
  });

  it("honours the from window", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics?from=2026-02-01T00:00:00Z", headers: auth() });
    const m = res.json();
    expect(m.total).toBe(59);
    expect(m.completed).toBe(52);
    expect(m.dispositions.find((d: { disposition: string | null }) => d.disposition === "resolved").count).toBe(40);
  });

  it("slaPct is null (not a fabricated 100) when nothing is scored", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics", headers: auth(OTHER_TENANT) });
    const m = res.json();
    expect(m.total).toBe(1);
    expect(m.slaScored).toBe(0);
    expect(m.slaPct).toBeNull();
  });

  it("400 on a malformed window or queue id", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics?from=yesterday", headers: auth() })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics?queueId=nope", headers: auth() })).statusCode).toBe(400);
  });
});
