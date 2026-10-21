/**
 * GAP-CRM-DOCUMENT-TYPES-03 -- deleting a document type.
 *
 * crm.documents(tenant_id, doc_type) references crm.document_types(tenant_id, code)
 * with ON DELETE SET NULL. On a composite key that nulls BOTH columns, and
 * tenant_id is NOT NULL, so deleting a type that documents still reference does
 * not "leave the documents with their type" (what the admin UI used to promise):
 * the database refuses it and the request used to fail as an opaque 500.
 *
 * The route now refuses an in-use delete up front with 409 TYPE_IN_USE (the type
 * and every document stay untouched; the admin disables the type instead), the
 * list reports a per-type usage count so the UI can say so BEFORE the click, and
 * the delete audit event records the admin's reason.
 *
 * DB-backed HTTP round-trips (queue drained so the CQRS confirm lands).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { resetClient } from "@civitasone/storage";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const SUBJECT = randomUUID();

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { savedEnv[k] = process.env[k]; process.env[k] = v; }

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-dt-del" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}
const adminHeaders = () => headers(["crm_admin"]);

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup() {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.documents WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.document_types WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
}

async function inject(method: string, url: string, opts: { headers: Record<string, string>; payload?: unknown }) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: opts.headers, payload: opts.payload as object });
  await app.close();
  return res;
}

async function createType(code: string): Promise<string> {
  const res = await inject("POST", "/v1/crm/document-types", {
    headers: adminHeaders(),
    payload: { code, name: `Type ${code}`, appliesTo: ["contact"] },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

/** presign -> confirm a document filed under `docType`. Returns the document id. */
async function fileDocument(docType: string): Promise<string> {
  const pre = await inject("POST", "/v1/crm/documents/presign", {
    headers: headers(),
    payload: { subjectType: "contact", subjectId: SUBJECT, filename: "f.pdf", mimeType: "application/pdf" },
  });
  const { storageKey } = pre.json().data;
  const res = await inject("POST", "/v1/crm/documents", {
    headers: headers(),
    payload: {
      subjectType: "contact", subjectId: SUBJECT, docType, title: "A document",
      filename: "f.pdf", storageKey, mimeType: "application/pdf", sizeBytes: 100,
    },
  });
  await drainQueue();
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

beforeAll(async () => {
  setEnv("AWS_ACCESS_KEY_ID", "test");
  setEnv("AWS_SECRET_ACCESS_KEY", "test");
  setEnv("AWS_DEFAULT_REGION", "ap-south-1");
  setEnv("AWS_S3_BUCKET", "civitas-test");
  setEnv("AWS_ENDPOINT_URL", "http://localhost:14566");
  setEnv("CRM_CONFIRM_REQUIRE_OBJECT", "0");
  resetClient();
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetClient();
  await sqlClient.end();
});

describe("GAP-CRM-DOCUMENT-TYPES-03: document type usage + delete", () => {
  it("reports how many documents use each type on the list", async () => {
    const used = await createType("dt_used_count");
    await createType("dt_unused_count");
    await fileDocument("dt_used_count");
    await fileDocument("dt_used_count");

    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<{ id: string; code: string; documentCount: number }>;
    expect(rows.find((r) => r.id === used)?.documentCount).toBe(2);
    expect(rows.find((r) => r.code === "dt_unused_count")?.documentCount).toBe(0);
  });

  it("refuses to delete a type that documents still use (409 TYPE_IN_USE) and changes nothing", async () => {
    const typeId = await createType("dt_in_use");
    const docId = await fileDocument("dt_in_use");

    const del = await inject("DELETE", `/v1/crm/document-types/${typeId}`, {
      headers: adminHeaders(), payload: { reason: "retire the type" },
    });
    expect(del.statusCode).toBe(409);
    const body = del.json();
    expect(body.code).toBe("TYPE_IN_USE");
    expect(body.message).toMatch(/1 document/);

    // The type is still there ...
    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    expect((list.json().data as Array<{ id: string }>).some((r) => r.id === typeId)).toBe(true);
    // ... and the document keeps its type.
    const docs = await scoped((tx) => tx<Array<{ doc_type: string | null }>>`
      SELECT doc_type FROM crm.documents WHERE id = ${docId}`);
    expect(docs[0]?.doc_type).toBe("dt_in_use");
    // A refused delete leaves no "document_type_delete" audit row.
    const audits = await scoped((tx) => tx`
      SELECT 1 FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'action' = 'document_type_delete' AND payload->>'resourceId' = ${typeId}`);
    expect(audits).toHaveLength(0);
  });

  it("deletes an unused type (204) and records the reason on the audit event", async () => {
    const typeId = await createType("dt_unused_delete");

    const del = await inject("DELETE", `/v1/crm/document-types/${typeId}`, {
      headers: adminHeaders(), payload: { reason: "duplicate of PAN card" },
    });
    expect(del.statusCode).toBe(204);

    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    expect((list.json().data as Array<{ id: string }>).some((r) => r.id === typeId)).toBe(false);

    const audits = await scoped((tx) => tx<Array<{ payload: { outcome: string; metadata?: { reason?: string | null; code?: string } } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'action' = 'document_type_delete' AND payload->>'resourceId' = ${typeId}`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload.outcome).toBe("success");
    expect(audits[0]!.payload.metadata?.reason).toBe("duplicate of PAN card");
    expect(audits[0]!.payload.metadata?.code).toBe("dt_unused_delete");
  });

  it("still deletes when no reason is sent (older callers) -- the audit reason is null", async () => {
    const typeId = await createType("dt_no_reason");
    const del = await inject("DELETE", `/v1/crm/document-types/${typeId}`, { headers: adminHeaders() });
    expect(del.statusCode).toBe(204);
    const audits = await scoped((tx) => tx<Array<{ payload: { metadata?: { reason?: string | null } } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'action' = 'document_type_delete' AND payload->>'resourceId' = ${typeId}`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload.metadata?.reason ?? null).toBeNull();
  });

  it("answers 404 for an unknown type and 403 for a non-admin", async () => {
    const missing = await inject("DELETE", `/v1/crm/document-types/${randomUUID()}`, { headers: adminHeaders() });
    expect(missing.statusCode).toBe(404);
    const typeId = await createType("dt_forbidden");
    const clerk = await inject("DELETE", `/v1/crm/document-types/${typeId}`, { headers: headers() });
    expect(clerk.statusCode).toBe(403);
  });

  it("rejects an over-long reason (400) without touching the type", async () => {
    const typeId = await createType("dt_long_reason");
    const del = await inject("DELETE", `/v1/crm/document-types/${typeId}`, {
      headers: adminHeaders(), payload: { reason: "x".repeat(501) },
    });
    expect(del.statusCode).toBe(400);
    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    expect((list.json().data as Array<{ id: string }>).some((r) => r.id === typeId)).toBe(true);
  });
});
