/**
 * GAP-CITIZEN-RTI-DETAIL-06: an RTI Act s.6(3) transfer leaves a statutory
 * trail. GET /v1/citizen/rti/:id returns transfers[] (oldest first) with the
 * authority the request came FROM, the one it went TO (resolved to the CPIO
 * directory's public-authority name when known), and when. The applicant sees
 * their own trail; another citizen gets 404.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";

registerRtiConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OWNER = randomUUID();
const OTHER = randomUUID();
const OFFICER = randomUUID();
const CPIO_FROM = randomUUID();
const CPIO_TO = randomUUID();
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json", "x-tenant-id": TENANT });
const ofH = hdr(OFFICER, ["citizen_officer"]);

let app: FastifyInstance;
let rtiId = "";

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}
const detail = (headers: Record<string, string>) => app.inject({ method: "GET", url: `/v1/citizen/rti/${rtiId}`, headers });

beforeAll(async () => {
  app = await buildApp();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO rti.cpio_directory (id, tenant_id, name, public_authority, created_by, updated_by)
              VALUES (${CPIO_TO}, ${TENANT}, 'A. Rao', 'Water Works Department', ${OFFICER}, ${OFFICER})`;
  });
  const r = await app.inject({
    method: "POST", url: "/v1/citizen/rti", headers: ofH,
    payload: { citizenId: OWNER, subject: "info", description: "please provide records", cpioRef: CPIO_FROM },
  });
  expect(r.statusCode).toBe(202);
  rtiId = r.json().id;
  await waitFor(async () => (await detail(ofH)).statusCode === 200);
}, 30000);

afterAll(async () => {
  await sqlClient
    .begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`DELETE FROM rti.citizen_rti_transfers WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM rti.citizen_rti_requests WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM rti.cpio_directory WHERE tenant_id = ${TENANT}`;
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/citizen/rti/:id — transfer history (GAP-CITIZEN-RTI-DETAIL-06)", () => {
  it("is an empty list before any transfer", async () => {
    expect((await detail(hdr(OWNER, ["citizen"]))).json().transfers).toEqual([]);
  });

  it("records from/to/when after a transfer, resolving the target to its directory authority name", async () => {
    const t = await app.inject({ method: "POST", url: `/v1/citizen/rti/${rtiId}/transfer`, headers: ofH, payload: { toAuthority: CPIO_TO } });
    expect(t.statusCode).toBe(202);
    const body = await waitFor(async () => {
      const b = (await detail(hdr(OWNER, ["citizen"]))).json();
      return b.transfers?.length === 1 ? b : null;
    });
    expect(body.transfers[0]).toMatchObject({ fromAuthority: CPIO_FROM, toAuthority: "Water Works Department" });
    expect(new Date(body.transfers[0].transferredAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(body.transfers[0]).not.toHaveProperty("transferredBy"); // internal officer id is not exposed to the applicant
  });

  it("another citizen cannot read the trail (404)", async () => {
    expect((await detail(hdr(OTHER, ["citizen"]))).statusCode).toBe(404);
  });
});
