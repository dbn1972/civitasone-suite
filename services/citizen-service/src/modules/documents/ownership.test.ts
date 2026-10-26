/**
 * V4-B-02 / V4-G-04 / V4-E-01 — object-level ownership on the citizen documents
 * routes. A citizen must not supersede another citizen's submission (resubmit),
 * attach an upload to another citizen's application, or read another citizen's
 * application checklist. Owner and officer keep access.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../../app.js";
import { sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { registerDocumentsConsumers } from "./consumer.js";
import { buildStorageKey } from "./storage.js";

vi.mock("./storage.js", async (orig) => ({
  ...(await orig<typeof import("./storage.js")>()),
  objectExists: async () => true,
}));

registerDocumentsConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = globalThis.crypto.randomUUID();
const OWNER = globalThis.crypto.randomUUID();
const ATTACKER = globalThis.crypto.randomUUID();
const OFFICER = globalThis.crypto.randomUUID();
const SERVICE = globalThis.crypto.randomUUID();
const APP_ID = globalThis.crypto.randomUUID();
const SUB_ID = globalThis.crypto.randomUUID();

function hdr(actor: string, roles: string[]) {
  const t = signToken({ sub: actor, tid: TENANT, roles, sid: "sess-v4-own" }, SECRET, 3600);
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}
const asOwner = () => hdr(OWNER, ["citizen"]);
const asAttacker = () => hdr(ATTACKER, ["citizen"]);
const asOfficer = () => hdr(OFFICER, ["citizen_officer"]);

async function tenantSql<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}
async function rowsFor(id: string) {
  return tenantSql((sql) => sql`SELECT id, status, citizen_id, supersedes_id FROM documents.submissions WHERE id = ${id}`);
}
async function countSupersedingOf(id: string) {
  const r = await tenantSql((sql) => sql`SELECT count(*)::int AS n FROM documents.submissions WHERE supersedes_id = ${id}`);
  return (r[0] as { n: number }).n;
}
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: Awaited<ReturnType<typeof buildApp>>;

async function seedDeficient(): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  await tenantSql((sql) => sql`
    INSERT INTO documents.submissions
      (id, tenant_id, application_id, citizen_id, service_id, doc_type, source, storage_ref, status, verification_status, authenticity, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${APP_ID}, ${OWNER}, ${SERVICE}, 'id_proof', 'upload', 'k', 'deficient', 'failed', 'self_attested', ${OWNER}, ${OWNER})`);
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await tenantSql((sql) => sql`
    INSERT INTO application.citizen_applications
      (id, tenant_id, citizen_id, service_id, ref_no, status, created_by, updated_by)
    VALUES (${APP_ID}, ${TENANT}, ${OWNER}, ${SERVICE}, ${"REF-" + APP_ID.slice(0, 8)}, 'submitted', ${OWNER}, ${OWNER})`);
  await tenantSql((sql) => sql`
    INSERT INTO documents.submissions
      (id, tenant_id, application_id, citizen_id, service_id, doc_type, source, storage_ref, status, verification_status, authenticity, created_by, updated_by)
    VALUES (${SUB_ID}, ${TENANT}, ${APP_ID}, ${OWNER}, ${SERVICE}, 'id_proof', 'upload', 'k', 'deficient', 'failed', 'self_attested', ${OWNER}, ${OWNER})`);
});

afterAll(async () => { await sqlClient.end(); });

describe("V4-B-02/E-01 resubmit ownership", () => {
  it("another citizen cannot supersede the victim's deficient submission (404, nothing written)", async () => {
    const key = buildStorageKey(TENANT, ATTACKER, "evil.pdf");
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${SUB_ID}/resubmit`, headers: asAttacker(),
      payload: { source: "upload", storageKey: key },
    });
    expect(res.statusCode).toBe(404);
    await new Promise((r) => setTimeout(r, 150));
    expect((await rowsFor(SUB_ID))[0]).toMatchObject({ status: "deficient" });
    expect(await countSupersedingOf(SUB_ID)).toBe(0);
  });

  it("the owning citizen can resubmit", async () => {
    const id = await seedDeficient();
    const key = buildStorageKey(TENANT, OWNER, "fixed.pdf");
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${id}/resubmit`, headers: asOwner(),
      payload: { source: "upload", storageKey: key },
    });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => (await rowsFor(id))[0]?.status === "superseded");
    expect(await countSupersedingOf(id)).toBe(1);
  });

  it("an officer can resubmit on a citizen's behalf", async () => {
    const id = await seedDeficient();
    const key = buildStorageKey(TENANT, OFFICER, "assisted.pdf");
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${id}/resubmit`, headers: asOfficer(),
      payload: { source: "upload", storageKey: key },
    });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => (await rowsFor(id))[0]?.status === "superseded");
  });
});

describe("V4-G-04 application ownership on upload / checklist", () => {
  it("another citizen cannot attach an upload to the victim's application", async () => {
    const key = buildStorageKey(TENANT, ATTACKER, "evil.pdf");
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: asAttacker(),
      payload: { applicationId: APP_ID, docType: "address_proof", storageKey: key },
    });
    expect(res.statusCode).toBe(404);
    await new Promise((r) => setTimeout(r, 150));
    const r = await tenantSql((sql) => sql`SELECT count(*)::int AS n FROM documents.submissions WHERE application_id = ${APP_ID} AND doc_type = 'address_proof'`);
    expect((r[0] as { n: number }).n).toBe(0);
  });

  it("the owner can upload to their own application", async () => {
    const key = buildStorageKey(TENANT, OWNER, "mine.pdf");
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: asOwner(),
      payload: { applicationId: APP_ID, docType: "address_proof", storageKey: key },
    });
    expect(res.statusCode).toBe(202);
  });

  it("another citizen cannot read the victim's application checklist", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents/checklist?applicationId=${APP_ID}`, headers: asAttacker(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("the owner can read their application checklist", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents/checklist?applicationId=${APP_ID}`, headers: asOwner(),
    });
    expect(res.statusCode).toBe(200);
  });
});
