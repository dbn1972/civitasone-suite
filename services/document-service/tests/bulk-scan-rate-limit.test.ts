/** Download / page-image routes are rate limited per tenant + user (429 with the standard body and Retry-After). */
import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { downloadRateLimit, pageImageRateLimit, rateLimitKey } from "../src/shared/rate-limit.js";
import { memoryStore, USER1, USER2, newTenant } from "./bulk-scan-helpers.js";
import { useFiling, seedFiled } from "./bulk-scan-review-helpers.js";

// DOCUMENT_RATE_LIMIT_ALLOWLIST deliberately UNSET: inject() requests come from 127.0.0.1, exactly like the gateway's,
// so these tests prove the default deployment is limited (a loopback exemption would make every assertion below fail).
delete process.env.DOCUMENT_RATE_LIMIT_ALLOWLIST;
process.env.DOCUMENT_DOWNLOAD_RATE_LIMIT = "3";
process.env.DOCUMENT_PAGE_IMAGE_RATE_LIMIT = "5";

const SECRET = process.env.JWT_SECRET as string;
const P = "/v1/documents/bulk-scan";
const hdr = (sub: string, roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub, roles, tid } as never, SECRET)}`, "x-tenant-id": tid });
const store = memoryStore();
let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

beforeAll(async () => {
  setPorts({ store }); useFiling();
  app = await (await import("../src/app.js")).buildApp();
});
afterEach(() => { store.objects.clear(); });
afterAll(async () => { resetPorts(); await app.close(); await sqlClient.end(); });

const get = (url: string, h: Record<string, string>) => app.inject({ method: "GET", url, headers: h });

describe("rate limits (env configurable, defaults 60 / 300 per minute)", () => {
  it("defaults when the env is unset or invalid", () => {
    const keep = { d: process.env.DOCUMENT_DOWNLOAD_RATE_LIMIT, p: process.env.DOCUMENT_PAGE_IMAGE_RATE_LIMIT };
    delete process.env.DOCUMENT_DOWNLOAD_RATE_LIMIT; process.env.DOCUMENT_PAGE_IMAGE_RATE_LIMIT = "abc";
    expect([downloadRateLimit(), pageImageRateLimit()]).toEqual([60, 300]);
    process.env.DOCUMENT_DOWNLOAD_RATE_LIMIT = keep.d; process.env.DOCUMENT_PAGE_IMAGE_RATE_LIMIT = keep.p;
  });
  it("the key is tenant + authenticated user, not the IP", () => {
    const t = newTenant();
    const mk = (sub: string) => ({ headers: hdr(sub, ["document_admin"], t), ip: "1.2.3.4" }) as never;
    expect(rateLimitKey(mk(USER1))).toBe(`${t}:${USER1}`);
    expect(rateLimitKey(mk(USER2))).toBe(`${t}:${USER2}`);
  });
});

describe("429 past the limit, keyed per tenant + user", () => {
  it("download: 3 allowed, the 4th is 429 (TOO_MANY_REQUESTS + Retry-After); another user, another tenant and the page-image route are not limited", async () => {
    const t = newTenant(), other = newTenant();
    const d = await seedFiled(store, t), o = await seedFiled(store, other);
    const url = `${P}/files/${d.documentId}/download`;
    for (let i = 0; i < 3; i++) expect((await get(url, hdr(USER1, ["document_admin"], t))).statusCode, `call ${i + 1}`).toBe(200);
    const blocked = await get(url, hdr(USER1, ["document_admin"], t));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ statusCode: 429, error: "TOO_MANY_REQUESTS" });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.json().retryAfter).toBeGreaterThan(0);
    // a different user in the same tenant is not limited
    expect((await get(url, hdr(USER2, ["document_admin"], t))).statusCode).toBe(200);
    // the same user id in another tenant is a different key
    expect((await get(`${P}/files/${o.documentId}/download`, hdr(USER1, ["document_admin"], other))).statusCode).toBe(200);
    // the page-image route has its own (higher) budget
    expect((await get(`${P}/files/${d.documentId}/pages/1/image`, hdr(USER1, ["document_admin"], t))).statusCode).toBe(200);
  });

  it("page image: 5 allowed, the 6th is 429", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t);
    const url = `${P}/files/${d.documentId}/pages/1/image`;
    for (let i = 0; i < 5; i++) expect((await get(url, hdr(USER1, ["document_admin"], t))).statusCode, `call ${i + 1}`).toBe(200);
    expect((await get(url, hdr(USER1, ["document_admin"], t))).statusCode).toBe(429);
    expect((await get(url, hdr(USER2, ["document_admin"], t))).statusCode).toBe(200);
  });
});
