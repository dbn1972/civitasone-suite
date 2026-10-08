/**
 * GAP-CITIZEN-GRIEVANCES-NEW-02 — officer filing a grievance on behalf of a
 * citizen is attributable, and the complainant contact is persisted (DB-backed).
 *
 * Fails on the old code: the register consumer dropped complainantContact and
 * never recorded a filing actor / on-behalf flag.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import type { FastifyInstance } from "fastify";

registerGrievanceConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9b1e0000-0000-4000-8000-000000000001";
const OFFICER = "9b1e0000-0000-4000-8000-0000000000f1";
const CITIZEN = "9b1e0000-0000-4000-8000-0000000000c1";

function tok(actor: string, roles: string[]) {
  return signToken({ sub: actor, tid: TENANT, roles, sid: "sess-fob" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function row(id: string): Promise<{ filed_by_actor: string | null; filed_on_behalf: boolean; complainant_name: string | null; complainant_contact: unknown } | null> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT filed_by_actor, filed_on_behalf, complainant_name, complainant_contact FROM grievance.citizen_grievances WHERE id = ${id} AND tenant_id = ${TENANT}`;
  });
  return (rows[0] as never) ?? null;
}

describe("GAP-CITIZEN-GRIEVANCES-NEW-02 — filed on behalf", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("officer-filed grievance stores the filing actor, on-behalf flag and contact", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances", headers: hdr(tok(OFFICER, ["citizen_officer"])),
      payload: {
        category: "service_delivery", subject: "No water", description: "No supply 5 days",
        citizenId: CITIZEN, complainantName: "Ramesh Kumar", filedOnBehalf: true,
        complainantContact: [{ kind: "mobile", value: "9876543210" }, { kind: "email", value: "ramesh@example.com" }],
      },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const persisted = await waitFor(() => row(id));
    expect(persisted.filed_by_actor).toBe(OFFICER);
    expect(persisted.filed_on_behalf).toBe(true);
    expect(persisted.complainant_name).toBe("Ramesh Kumar");
    expect(Array.isArray(persisted.complainant_contact)).toBe(true);
    expect((persisted.complainant_contact as unknown[]).length).toBe(2);
  });

  it("the detail read model surfaces filedBy + masked contact (no raw PII)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/citizen/grievances", headers: hdr(tok(OFFICER, ["citizen_officer"])),
      payload: {
        category: "service_delivery", subject: "Street light", description: "Dark lane",
        citizenId: CITIZEN, complainantName: "Sita", filedOnBehalf: true,
        complainantContact: [{ kind: "mobile", value: "9123456789" }],
      },
    });
    const id = create.json().id as string;
    await waitFor(() => row(id));
    const detail = await app.inject({ method: "GET", url: `/v1/citizen/grievances/${id}`, headers: hdr(tok(OFFICER, ["citizen_officer"])) });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.filedBy).toBe(OFFICER);
    expect(body.filedOnBehalf).toBe(true);
    expect(body.complainantContactMasked[0].kind).toBe("mobile");
    expect(body.complainantContactMasked[0].masked).toMatch(/•+6789$/);
    // raw value never surfaced
    expect(JSON.stringify(body)).not.toContain("9123456789");
  });

  it("a citizen filing for themselves is NOT marked on-behalf", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances", headers: hdr(tok(CITIZEN, ["citizen"])),
      payload: { category: "service_delivery", subject: "Self", description: "My own grievance" },
    });
    const id = res.json().id as string;
    const persisted = await waitFor(() => row(id));
    expect(persisted.filed_by_actor).toBe(CITIZEN);
    expect(persisted.filed_on_behalf).toBe(false);
  });
});
