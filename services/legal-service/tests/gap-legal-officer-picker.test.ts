/**
 * F4 (owner decision 2026-10-27): the privileged-case officer picker searches the HRMS employee directory
 * (legal-service already talks to HRMS_SERVICE_URL) so a privileged case can be assigned to officers beyond
 * its creator. The picker returns the officer's LOGIN id (hrms user_ref), because that is what the access
 * check compares with the caller's actor id.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { createHttpOfficerClient, setOfficerClient, type OfficerClient } from "../src/shared/officer-client.js";
import { OrgServiceError } from "../src/shared/org-client.js";
import { useFakeOrg, TEST_DEPT_ID } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = "11111111-aaaa-4000-8000-0000000f4001";
const CREATOR = crypto.randomUUID();
const PEER = crypto.randomUUID();
const OUTSIDER = crypto.randomUUID();
const GHOST = crypto.randomUUID();
const tok = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });
const drain = () => new Promise<void>((r) => setTimeout(r, 400));

describe("officer client (HRMS employee directory)", () => {
  const CTX = { tenantId: TENANT, correlationId: "c1" };
  const mk = (res: () => Response | Promise<Response>) => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return res(); }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  };
  const rows = [
    { id: "e1", fullName: "Asha Rao", employeeNo: "E-001", departmentName: "Revenue", userRef: PEER },
    { id: "e2", fullName: "No Login", employeeNo: "E-002", departmentName: "Revenue" },
    { id: "e3", fullName: 5 },
  ];

  it("searches with q, sends internal auth, and keeps only employees that have a login (userRef)", async () => {
    const { seen, fetchImpl } = mk(() => new Response(JSON.stringify(rows), { status: 200 }));
    const c = createHttpOfficerClient({ baseUrl: "http://hrms:3012/", secret: "s", fetchImpl });
    expect(await c.search(CTX, "as ra")).toEqual([{ id: PEER, name: "Asha Rao", employeeNo: "E-001", department: "Revenue" }]);
    expect(seen[0]!.url).toBe("http://hrms:3012/v1/hrms/internal/employee-summaries?q=as%20ra");
    expect(seen[0]!.headers["x-internal"]).toBe("1");
    expect(seen[0]!.headers["x-tenant-id"]).toBe(TENANT);
    expect(seen[0]!.headers["x-service-secret"]).toBe("s");
  });

  it("resolves login ids with actorIds", async () => {
    const { seen, fetchImpl } = mk(() => new Response(JSON.stringify(rows), { status: 200 }));
    const c = createHttpOfficerClient({ baseUrl: "http://h", secret: "s", fetchImpl });
    await c.resolve(CTX, [PEER, OUTSIDER]);
    expect(seen[0]!.url).toBe(`http://h/v1/hrms/internal/employee-summaries?actorIds=${PEER}%2C${OUTSIDER}`);
  });

  it("is not_configured without a secret and unavailable on errors, never leaking upstream text", async () => {
    const none = createHttpOfficerClient({ baseUrl: "http://h", secret: "", fetchImpl: mk(() => new Response("[]")).fetchImpl });
    await expect(none.search(CTX, "ab")).rejects.toMatchObject({ kind: "not_configured" });
    const five = createHttpOfficerClient({ baseUrl: "http://h", secret: "s", fetchImpl: mk(() => new Response("boom", { status: 500 })).fetchImpl });
    await expect(five.search(CTX, "ab")).rejects.toBeInstanceOf(OrgServiceError);
    const boom = createHttpOfficerClient({ baseUrl: "http://h", secret: "s", fetchImpl: mk(() => { throw new Error("ECONNREFUSED 10.9.9.9"); }).fetchImpl });
    const err = await boom.search(CTX, "ab").catch((e) => e);
    expect(err).toBeInstanceOf(OrgServiceError);
    expect(String(err.message)).not.toContain("10.9.9.9");
  });
});

const directory: Record<string, { id: string; name: string; employeeNo: string; department: string }> = {
  [PEER]: { id: PEER, name: "Asha Rao", employeeNo: "E-001", department: "Revenue" },
};
const fakeOfficers: OfficerClient = {
  async search(_ctx, q) { return Object.values(directory).filter((o) => o.name.toLowerCase().includes(q.toLowerCase())); },
  async resolve(_ctx, ids) { return ids.map((i) => directory[i]).filter((o): o is NonNullable<typeof o> => !!o); },
};

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  }));
  await cache.invalidateResource(TENANT, "cases");
}

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  useFakeOrg();
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerCaseConsumers(queue);
  app = await buildApp();
});
beforeEach(() => setOfficerClient(fakeOfficers));
afterAll(async () => { await wipe(); await app.close(); setOfficerClient(null); });

describe("GET /v1/legal/officers", () => {
  const search = (q: string, h = tok(CREATOR, ["legal_officer"])) => app.inject({ method: "GET", url: `/v1/legal/officers?q=${encodeURIComponent(q)}`, headers: h });

  it("returns matching officers (login id, name, employee no, department) to a legal officer", async () => {
    const r = await search("asha");
    expect(r.statusCode).toBe(200);
    expect((r.json() as { items: unknown[] }).items).toEqual([directory[PEER]]);
  });

  it("rejects a too-short query and callers without a legal role", async () => {
    expect((await search("a")).statusCode).toBe(400);
    expect((await search("asha", tok(OUTSIDER, ["audit_officer"]))).statusCode).toBe(403);
  });

  it("answers 503 (not an empty list) when the directory is down, without leaking the cause", async () => {
    setOfficerClient({ async search() { throw new OrgServiceError("unavailable", "ECONNREFUSED hrms 10.1.1.1"); }, async resolve() { return []; } });
    const r = await search("asha");
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("10.1.1.1");
  });
});

describe("creating a privileged case with additional officers", () => {
  const body = (o: Record<string, unknown>) => ({ caseNo: `WP/F4-${crypto.randomUUID().slice(0, 8)}/2026`, title: "T", courtCode: "hc_delhi", filingDate: "2026-03-01", departmentId: TEST_DEPT_ID, ...o });
  const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/legal/cases", headers: tok(CREATOR, ["legal_officer"]), payload });
  const rowOf = async (caseNo: string) => (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, caseNo)))))[0]!;

  it("keeps the creator and adds the picked officer, so both can open the case and others cannot", async () => {
    const payload = body({ privileged: true, assignedOfficerIds: [PEER] });
    expect((await post(payload)).statusCode).toBe(202);
    await drain();
    const row = await rowOf(payload.caseNo as string);
    expect([...row.assignedOfficerIds].sort()).toEqual([CREATOR, PEER].sort());
    const get = (sub: string) => app.inject({ method: "GET", url: `/v1/legal/cases/${row.id}`, headers: tok(sub, ["legal_officer"]) });
    expect((await get(CREATOR)).statusCode).toBe(200);
    expect((await get(PEER)).statusCode).toBe(200);
    expect((await get(OUTSIDER)).statusCode).toBe(404);
  });

  it("rejects an officer id the directory does not know (422) and creates nothing", async () => {
    const payload = body({ privileged: true, assignedOfficerIds: [GHOST] });
    const r = await post(payload);
    expect(r.statusCode).toBe(422);
    expect((r.json() as { code: string }).code).toBe("UNKNOWN_OFFICER");
    await drain();
    expect(await rowOf(payload.caseNo as string)).toBeUndefined();
  });

  it("fails closed with 503 when the directory is down and officers other than the creator were named", async () => {
    setOfficerClient({ async search() { return []; }, async resolve() { throw new OrgServiceError("unavailable", "down"); } });
    expect((await post(body({ privileged: true, assignedOfficerIds: [PEER] }))).statusCode).toBe(503);
  });

  it("does not call the directory when only the creator is named", async () => {
    setOfficerClient({ async search() { return []; }, async resolve() { throw new Error("must not be called"); } });
    const payload = body({ privileged: true, assignedOfficerIds: [CREATOR] });
    expect((await post(payload)).statusCode).toBe(202);
    await drain();
    expect((await rowOf(payload.caseNo as string)).assignedOfficerIds).toEqual([CREATOR]);
  });
});
