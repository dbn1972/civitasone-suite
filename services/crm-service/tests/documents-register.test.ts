/**
 * GAP-CRM-DOCUMENTS-02 — cross-record document register.
 *
 * Covers: GET /v1/crm/documents/register pages across every record (not one
 * subject); filters by scanStatus, expiringWithinDays and missingMandatory;
 * is tenant-scoped (RLS); and returns subject type + id (no cross-module join).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { resetClient } from "@civitasone/storage";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-00000000e001";
const OTHER = "aaaaaaaa-1111-4000-8000-00000000e002";
const ACTOR = "cccccccc-3333-4000-8000-00000000e001";
const SUBJECT_A = "22222222-bbbb-4000-8000-00000000e0a1";
const SUBJECT_B = "22222222-bbbb-4000-8000-00000000e0b2";

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}
function adminHeaders(tenant = TENANT) {
  return headers(tenant, ["crm_admin"]);
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient
      .begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
        await tx`DELETE FROM crm.documents WHERE tenant_id = ${t}`.catch(() => {});
        await tx`DELETE FROM crm.document_types WHERE tenant_id = ${t}`.catch(() => {});
      })
      .catch(() => {});
  }
}

beforeAll(async () => {
  setEnv("AWS_ACCESS_KEY_ID", "test");
  setEnv("AWS_SECRET_ACCESS_KEY", "test");
  setEnv("AWS_DEFAULT_REGION", "ap-south-1");
  setEnv("AWS_S3_BUCKET", "civitas-test");
  setEnv("AWS_ENDPOINT_URL", "http://localhost:14566");
  setEnv("INTERNAL_SERVICE_SECRET", "reg_test_secret");
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
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetClient();
  await sqlClient.end();
});

async function inject(method: string, url: string, opts: { headers: Record<string, string>; payload?: unknown }) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: opts.headers, payload: opts.payload as object });
  await app.close();
  return res;
}

async function upload(
  subjectId: string,
  overrides: Record<string, unknown> = {},
  tenant = TENANT,
): Promise<string> {
  const pre = await inject("POST", "/v1/crm/documents/presign", {
    headers: headers(tenant),
    payload: { subjectType: "contact", subjectId, filename: "d.pdf", mimeType: "application/pdf" },
  });
  const { storageKey } = pre.json().data;
  const res = await inject("POST", "/v1/crm/documents", {
    headers: headers(tenant),
    payload: {
      subjectType: "contact",
      subjectId,
      title: "Doc",
      filename: "d.pdf",
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: 10,
      ...overrides,
    },
  });
  await drainQueue();
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

async function scan(id: string, status: string) {
  await inject("POST", `/v1/crm/documents/${id}/scan-result`, {
    headers: { "x-internal": "1", "x-service-secret": "reg_test_secret", "x-tenant-id": TENANT },
    payload: { scanStatus: status },
  });
  await drainQueue();
}

describe("GAP-CRM-DOCUMENTS-02 register", () => {
  it("lists documents across multiple records and returns subject type + id", async () => {
    await upload(SUBJECT_A, { docType: undefined });
    await upload(SUBJECT_B, { docType: undefined });

    const res = await inject("GET", "/v1/crm/documents/register", { headers: headers() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ subjectType: string; subjectId: string; kind: string }>;
    const subjectIds = data.map((r) => r.subjectId);
    expect(subjectIds).toEqual(expect.arrayContaining([SUBJECT_A, SUBJECT_B]));
    expect(data.every((r) => r.subjectType === "contact")).toBe(true);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by scanStatus (only infected rows)", async () => {
    const infectedId = await upload(SUBJECT_A, { docType: undefined });
    await scan(infectedId, "infected");

    const res = await inject("GET", "/v1/crm/documents/register?scanStatus=infected", { headers: headers() });
    const data = res.json().data as Array<{ id: string; scanStatus: string }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((r) => r.scanStatus === "infected")).toBe(true);
    expect(data.some((r) => r.id === infectedId)).toBe(true);
  });

  it("filters by expiringWithinDays (expired/soon only)", async () => {
    await upload(SUBJECT_B, { docType: undefined, expiryDate: "2020-01-01" }); // long expired
    await upload(SUBJECT_B, { docType: undefined }); // no expiry

    const res = await inject("GET", "/v1/crm/documents/register?expiringWithinDays=30", { headers: headers() });
    const data = res.json().data as Array<{ expiryDate: string | null }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    // Every returned row has an expiry date (the no-expiry doc is excluded).
    expect(data.every((r) => r.expiryDate !== null)).toBe(true);
  });

  it("missingMandatory surfaces subjects lacking a current mandatory document", async () => {
    // A mandatory type for contacts; SUBJECT_A owns docs but none of this type.
    await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(),
      payload: { code: "pan_card", name: "PAN Card", appliesTo: ["contact"], mandatory: true },
    });

    const res = await inject("GET", "/v1/crm/documents/register?missingMandatory=true", { headers: headers() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ subjectId: string; docTypeCode: string; kind: string }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((r) => r.kind === "missing_mandatory")).toBe(true);
    expect(data.every((r) => r.docTypeCode === "pan_card")).toBe(true);
    expect(data.map((r) => r.subjectId)).toEqual(expect.arrayContaining([SUBJECT_A]));
  });

  it("does not leak another tenant's documents (RLS)", async () => {
    await upload("22222222-bbbb-4000-8000-00000000e0c3", { docType: undefined }, OTHER);
    const mine = await inject("GET", "/v1/crm/documents/register?limit=200", { headers: headers() });
    const subjectIds = (mine.json().data as Array<{ subjectId: string }>).map((r) => r.subjectId);
    expect(subjectIds).not.toContain("22222222-bbbb-4000-8000-00000000e0c3");
  });
});
