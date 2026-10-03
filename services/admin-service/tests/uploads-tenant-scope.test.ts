/**
 * fp-assets-01: upload key scoping.
 *  - the download check is a PREFIX check on the caller's own tenant (key.includes(tenantId) was forgeable);
 *  - presigned keys carry the uploader's id so consumers can bind an attachment to its uploader;
 *  - asset staff can open attachments / documents / photos but not resumes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

vi.mock("@civitasone/storage", () => ({
  presignedPutUrl: vi.fn(async ({ key }: { key: string }) => `https://s3.example/put/${key}`),
  presignedGetUrl: vi.fn(async ({ key }: { key: string }) => `https://s3.example/get/${key}`),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "11111111-aaaa-4000-8000-0000000fa101";
const T2 = "22222222-aaaa-4000-8000-0000000fa102";
const USER = "cccccccc-3333-4000-8000-0000000fa101";
const tok = (tid: string, roles: string[]) => signToken({ sub: USER, tid, roles, sid: "s-up" } as never, SECRET);
const auth = (tid: string, roles: string[]) => ({ authorization: `Bearer ${tok(tid, roles)}` });
const FILE = "00000000-0000-4000-8000-000000000001.pdf";

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("upload download scoping", () => {
  it("opens a key under the caller's own tenant prefix", async () => {
    const key = `uploads/${T1}/attachment/${USER}/${FILE}`;
    const res = await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(key)}`, headers: auth(T1, ["admin"]) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).downloadUrl).toContain(key);
  });

  it("refuses another tenant's key, including one that merely CONTAINS the caller's tenant id (the old includes() bypass)", async () => {
    const other = `uploads/${T2}/attachment/${USER}/${FILE}`;
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(other)}`, headers: auth(T1, ["admin"]) })).statusCode).toBe(403);
    const forged = `uploads/${T2}/attachment/${T1}/${FILE}`; // T1's id appears in the key, but the key is T2's
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(forged)}`, headers: auth(T1, ["admin"]) })).statusCode).toBe(403);
    const prefixless = `elsewhere/${T1}/attachment/${FILE}`;
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(prefixless)}`, headers: auth(T1, ["admin"]) })).statusCode).toBe(403);
  });

  it("asset staff may open attachments but not resumes; other roles still can", async () => {
    const resume = `uploads/${T1}/resume/${USER}/${FILE}`;
    const attachment = `uploads/${T1}/attachment/${USER}/${FILE}`;
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(resume)}`, headers: auth(T1, ["asset_manager"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(attachment)}`, headers: auth(T1, ["asset_manager"]) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(resume)}`, headers: auth(T1, ["hr_admin"]) })).statusCode).toBe(200);
  });
});

describe("presign key layout", () => {
  it("puts the tenant and the uploader in the key, and lets asset roles presign", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign", headers: auth(T1, ["asset_manager"]),
      payload: { category: "attachment", filename: "fir.pdf", contentType: "application/pdf" },
    });
    expect(res.statusCode).toBe(200);
    const key = JSON.parse(res.body).key as string;
    expect(key).toMatch(new RegExp(`^uploads/${T1}/attachment/${USER}/[0-9a-f-]{36}\\.pdf$`));
  });
});
