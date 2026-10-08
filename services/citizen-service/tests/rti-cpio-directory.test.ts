/**
 * GAP-CITIZEN-RTI-03 — CPIO / public-authority directory (DB-backed).
 *
 * Asserts the NEW capability (fails on old code: no directory endpoint existed):
 *   • officer POST /rti/cpios registers a CPIO (persisted + audited in one txn);
 *   • a bare citizen may NOT create (403 — server role check, not UI hiding);
 *   • GET /rti/cpios lists active entries and searches by name/authority;
 *   • the directory projection NEVER leaks email/phone (DPDP minimisation);
 *   • the returned id is a real uuid usable as cpioRef on an RTI request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerCpioConsumers } from "../src/modules/cpio/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import type { FastifyInstance } from "fastify";

registerCpioConsumers(queue);
registerRtiConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c910c910-0000-4000-8000-000000000001";
const OFFICER = "c910c910-0000-4000-8000-0000000000f1";
const CITIZEN = "c910c910-0000-4000-8000-0000000000c1";

function tok(tenant: string, actor: string, roles: string[]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-cpio" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT }; }
const officer = () => hdr(tok(TENANT, OFFICER, ["citizen_officer"]));
const citizen = () => hdr(tok(TENANT, CITIZEN, ["citizen"]));

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("GAP-CITIZEN-RTI-03 — CPIO directory", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  let cpioId: string;

  it("rejects a bare citizen creating a CPIO entry (403, server-enforced)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/rti/cpios", headers: citizen(),
      payload: { name: "Rogue", publicAuthority: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("an officer registers a CPIO (persisted + audited)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/rti/cpios", headers: officer(),
      payload: {
        name: "A. Sharma", designation: "Deputy Secretary",
        publicAuthority: "Municipal Corporation", department: "Water Supply",
        email: "cpio.water@example.gov.in", phone: "9876500000",
      },
    });
    expect(res.statusCode).toBe(202);
    cpioId = res.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: "/v1/citizen/rti/cpios?q=Sharma", headers: citizen() });
      return g.json().data.some((c: { id: string }) => c.id === cpioId) ? g.json() : null;
    });
  });

  it("audits the create in the same tenant outbox", async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`;
    });
    const found = rows.some((r: { payload: { action?: string; resourceId?: string } }) =>
      r.payload.action === "cpio_directory_create" && r.payload.resourceId === cpioId);
    expect(found).toBe(true);
  });

  it("a citizen can look up the CPIO by name — picker source", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/rti/cpios?q=Water", headers: citizen() });
    expect(res.statusCode).toBe(200);
    const entry = res.json().data.find((c: { id: string }) => c.id === cpioId);
    expect(entry).toBeDefined();
    expect(entry.name).toBe("A. Sharma");
    expect(entry.publicAuthority).toBe("Municipal Corporation");
  });

  it("the directory projection does NOT leak email/phone (DPDP)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/rti/cpios?q=Sharma", headers: citizen() });
    const entry = res.json().data.find((c: { id: string }) => c.id === cpioId);
    expect(entry.email).toBeUndefined();
    expect(entry.phone).toBeUndefined();
  });

  it("the directory id is accepted as cpioRef when filing an RTI", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/rti", headers: citizen(),
      payload: { subject: "Water bills", description: "Copies of water bills for 2024", cpioRef: cpioId },
    });
    expect(res.statusCode).toBe(202);
  });
});
