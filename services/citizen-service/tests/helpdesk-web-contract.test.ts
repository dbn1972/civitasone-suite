/**
 * Contract tests for what the helpdesk web reads from citizen-service:
 *  - GET /v1/citizen/tickets?slaStatus=... (within_sla / due_soon used to 500: the
 *    raw sql`` templates bound a JS Date that postgres.js rejects),
 *  - GET /v1/citizen/tickets/analytics?period=mtd|qtd|fy (the filter was ignored),
 *  - POST /v1/citizen/tickets 202 ack ({ id, data: { id, ticketNo } }) and the
 *    requester name stored as its own field instead of folded into the description.
 * Real HTTP route -> queue -> consumer -> DB round trip (memory queue, own tenants).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { citizenTickets } from "../src/modules/helpdesk/schema.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";
import { periodStart } from "../src/modules/helpdesk/sla.js";

registerHelpdeskConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const OFFICER = "99999999-9999-4000-8000-0000000000c1";
const CITIZEN = "11111111-1111-4000-8000-0000000000c1";
const app = await buildApp();
const tenants: string[] = [];

function headers(tenant: string) {
  return {
    authorization: `Bearer ${signToken({ sub: OFFICER, tid: tenant, roles: ["citizen_officer"], sid: "s" }, SECRET)}`,
    "content-type": "application/json",
  };
}

function newTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

type Seed = { subject: string; status?: string; slaDueAt?: Date | null; createdAt?: Date };
async function seed(tenant: string, rows: Seed[]) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(citizenTickets).values(
        rows.map((r) => ({
          id: randomUUID(), tenantId: tenant, citizenId: CITIZEN, ticketNo: `T-${randomUUID().slice(0, 6)}`,
          subject: r.subject, description: "d", status: r.status ?? "open", priority: "medium",
          slaDueAt: r.slaDueAt === undefined ? null : r.slaDueAt,
          ...(r.createdAt ? { createdAt: r.createdAt } : {}),
          createdBy: OFFICER, updatedBy: OFFICER,
        })),
      ),
    ),
  );
}

afterAll(async () => {
  for (const t of tenants) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(citizenTickets).where(eq(citizenTickets.tenantId, t))));
  }
  await sqlClient.end();
});

const H = 3_600_000;

describe("GET /v1/citizen/tickets?slaStatus= (500 on main for within_sla / due_soon)", () => {
  it("returns 200 and the right tickets for every slaStatus filter", async () => {
    const tenant = newTenant();
    const now = Date.now();
    await seed(tenant, [
      { subject: "soon", slaDueAt: new Date(now + 2 * H) },
      { subject: "later", slaDueAt: new Date(now + 72 * H) },
      { subject: "late", slaDueAt: new Date(now - 1 * H) },
      { subject: "done", status: "resolved", slaDueAt: new Date(now - 5 * H) },
    ]);
    const subjects = async (sla: string) => {
      const res = await app.inject({ method: "GET", url: `/v1/citizen/tickets?slaStatus=${sla}`, headers: headers(tenant) });
      expect(res.statusCode).toBe(200);
      return res.json().data.map((t: { subject: string }) => t.subject).sort();
    };
    expect(await subjects("due_soon")).toEqual(["soon"]);
    expect(await subjects("within_sla")).toEqual(["done", "later"]);
    expect(await subjects("breached")).toEqual(["late"]);
  });

  it("rejects an unknown slaStatus with 400 (not 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/tickets?slaStatus=bogus", headers: headers(newTenant()) });
    expect(res.statusCode).toBe(400);
  });
});

describe("periodStart (Indian calendar, midnight IST)", () => {
  const at = (iso: string) => new Date(iso);
  it("mtd/qtd/fy boundaries in October (Q3 of the fiscal year)", () => {
    const now = at("2026-10-22T10:00:00Z");
    expect(periodStart("mtd", now).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(periodStart("qtd", now).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(periodStart("fy", now).toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });
  it("qtd/fy before April belong to the previous fiscal year", () => {
    const now = at("2026-02-10T10:00:00Z");
    expect(periodStart("mtd", now).toISOString()).toBe("2026-01-31T18:30:00.000Z");
    expect(periodStart("qtd", now).toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(periodStart("fy", now).toISOString()).toBe("2025-03-31T18:30:00.000Z");
  });
  it("IST rollover: 20:00 UTC on the last day is already next month in IST", () => {
    expect(periodStart("mtd", at("2026-08-31T20:00:00Z")).toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });
});

describe("GET /v1/citizen/tickets/analytics?period=", () => {
  it("filters by creation date for mtd / qtd / fy and is all-time without a period", async () => {
    const tenant = newTenant();
    const now = new Date();
    const old = new Date(now.getTime() - 400 * 24 * H); // outside any period
    const justBeforeMonth = new Date(periodStart("mtd", now).getTime() - H);
    await seed(tenant, [
      { subject: "today", createdAt: now },
      { subject: "last month", createdAt: justBeforeMonth },
      { subject: "ancient", createdAt: old },
    ]);
    const total = async (q: string) => {
      const res = await app.inject({ method: "GET", url: `/v1/citizen/tickets/analytics${q}`, headers: headers(tenant) });
      expect(res.statusCode).toBe(200);
      return res.json().totalTickets as number;
    };
    const expected = (p: "mtd" | "qtd" | "fy") => [now, justBeforeMonth, old].filter((d) => d >= periodStart(p, now)).length;
    expect(await total("")).toBe(3);
    expect(await total("?period=mtd")).toBe(expected("mtd"));
    expect(expected("mtd")).toBe(1);
    expect(await total("?period=qtd")).toBe(expected("qtd"));
    expect(await total("?period=fy")).toBe(expected("fy"));
    // the filter actually changes the answer
    expect(await total("?period=mtd")).toBeLessThan(await total(""));
  });

  it("rejects an unknown period with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/tickets/analytics?period=decade", headers: headers(newTenant()) });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/citizen/tickets — ack shape + requester name", () => {
  it("returns { id, data: { id, ticketNo } } and stores requesterName separately from the description", async () => {
    const tenant = newTenant();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/tickets", headers: headers(tenant),
      payload: { subject: "Walk-in complaint", description: "Water supply issue", channel: "walk_in", requesterName: "Asha Verma" },
    });
    expect(res.statusCode).toBe(202);
    const ack = res.json();
    expect(ack.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ack.data.id).toBe(ack.id);
    expect(ack.data.ticketNo).toMatch(/^HD-[0-9A-F]{8}$/);

    let detail: { statusCode: number; json: () => Record<string, unknown> } | undefined;
    for (let i = 0; i < 40; i++) {
      detail = await app.inject({ method: "GET", url: `/v1/citizen/tickets/${ack.id}`, headers: headers(tenant) });
      if (detail.statusCode === 200) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(detail?.statusCode).toBe(200);
    const d = detail!.json();
    expect(d.requesterName).toBe("Asha Verma");
    expect(d.description).toBe("Water supply issue"); // no "Reported by:" preamble
    expect(d.ticketNo).toBe(ack.data.ticketNo);
  });
});
