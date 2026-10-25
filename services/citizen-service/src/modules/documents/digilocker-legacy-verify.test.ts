/**
 * V4-G-03 — the legacy citizen-supplied-docUri DigiLocker paths (digilocker-fetch
 * and a digilocker-source resubmit) must NEVER mark a document verified /
 * source_verified, even when the provider is configured and a live consent
 * exists. Only the OAuth callback (PKCS#7-verified artefact) or an officer may.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

process.env.CITIZEN_DIGILOCKER_CLIENT_ID = `cid-${globalThis.crypto.randomUUID()}`;
process.env.CITIZEN_DIGILOCKER_CLIENT_SECRET = globalThis.crypto.randomUUID();

const { buildApp } = await import("../../app.js");
const { sqlClient } = await import("../../shared/db.js");
const { queue } = await import("../../shared/infra.js");
const { registerDocumentsConsumers } = await import("./consumer.js");

vi.mock("./storage.js", async (orig) => ({
  ...(await orig<typeof import("./storage.js")>()),
  objectExists: async () => true,
}));

registerDocumentsConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = globalThis.crypto.randomUUID();
const CITIZEN = globalThis.crypto.randomUUID();

function hdr() {
  const t = signToken({ sub: CITIZEN, tid: TENANT, roles: ["citizen"], sid: "sess-v4-g03" }, SECRET, 3600);
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}
async function tenantSql<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}
async function waitRow(id: string) {
  for (let i = 0; i < 120; i++) {
    const r = await tenantSql((sql) => sql`SELECT status, verification_status, authenticity, verified_by FROM documents.submissions WHERE id = ${id}`);
    if (r[0]) return r[0] as { status: string; verification_status: string; authenticity: string; verified_by: string | null };
    await new Promise((x) => setTimeout(x, 25));
  }
  throw new Error("row not written");
}
async function verifiedEvents(id: string): Promise<number> {
  const r = await tenantSql((sql) => sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND payload->>'id' = ${id} AND event_type = 'citizen.document.verified'`);
  return (r[0] as { n: number }).n;
}

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp();
  await tenantSql((sql) => sql`
    INSERT INTO documents.digilocker_consents (tenant_id, actor_id, citizen_id, purpose, doc_type, expires_at, created_by, updated_by)
    VALUES (${TENANT}, ${CITIZEN}, ${CITIZEN}, 'test', 'id_proof', now() + interval '1 day', ${CITIZEN}, ${CITIZEN})`);
});
afterAll(async () => { await sqlClient.end(); });

describe("V4-G-03 legacy DigiLocker paths never self-verify", () => {
  it("digilocker-fetch with a forged docUri stays received/pending/unverified, no verifier, no verified event", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/digilocker-fetch", headers: hdr(),
      payload: { docType: "id_proof", docUri: "digilocker://forged/anything" },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const row = await waitRow(id);
    expect(row).toMatchObject({ status: "received", verification_status: "pending", authenticity: "unverified", verified_by: null });
    expect(await verifiedEvents(id)).toBe(0);
  });

  it("a digilocker-source resubmit with a forged docUri is not verified either", async () => {
    const prior = globalThis.crypto.randomUUID();
    await tenantSql((sql) => sql`
      INSERT INTO documents.submissions (id, tenant_id, citizen_id, doc_type, source, storage_ref, status, verification_status, authenticity, created_by, updated_by)
      VALUES (${prior}, ${TENANT}, ${CITIZEN}, 'id_proof', 'upload', 'k', 'deficient', 'failed', 'self_attested', ${CITIZEN}, ${CITIZEN})`);
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${prior}/resubmit`, headers: hdr(),
      payload: { source: "digilocker", docUri: "digilocker://forged/anything" },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const row = await waitRow(id);
    expect(row).toMatchObject({ status: "received", verification_status: "pending", authenticity: "unverified", verified_by: null });
    expect(await verifiedEvents(id)).toBe(0);
  });
});
