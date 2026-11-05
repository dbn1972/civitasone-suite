/**
 * resolveDocIdentity fails CLOSED (PR #2463 delta review): a tenant-service error, timeout, non-2xx or bad body throws
 * TenantIdentityUnavailableError (code TENANT_IDENTITY_UNAVAILABLE, a DocumentUnavailableError so callers answer 503);
 * it never returns an empty identity, never falls back to env, and a failure is never cached. A successful read with
 * no documentIdentity is a normal result.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentUnavailableError, EMPTY_DOC_IDENTITY, PdfRendererUnavailableError, TenantIdentityUnavailableError,
  resetDocIdentityCache, resolveDocIdentity,
} from "./index.js";

type Fetch = Parameters<typeof resolveDocIdentity>[1];
const reply = (ok: boolean, body: unknown): ReturnType<NonNullable<Fetch>> => Promise.resolve({ ok, json: async () => { if (body instanceof Error) throw body; return body; } });

afterEach(() => { resetDocIdentityCache(); vi.unstubAllEnvs(); });

describe("resolveDocIdentity fails closed", () => {
  it.each([
    ["fetch rejects (timeout / refused)", () => Promise.reject(new TypeError("fetch failed"))],
    ["non-2xx", () => reply(false, {})],
    ["unreadable body", () => reply(true, new SyntaxError("bad json"))],
    ["null body", () => reply(true, null)],
    ["string body", () => reply(true, "text")],
  ] as const)("%s throws TenantIdentityUnavailableError", async (_n, f) => {
    const err = await resolveDocIdentity("t-1", f as Fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantIdentityUnavailableError);
    expect(err).toBeInstanceOf(DocumentUnavailableError);
    expect((err as TenantIdentityUnavailableError).code).toBe("TENANT_IDENTITY_UNAVAILABLE");
  });

  it("PdfRendererUnavailableError is the same 503 family with its own code", () => {
    const e = new PdfRendererUnavailableError();
    expect(e).toBeInstanceOf(DocumentUnavailableError);
    expect(e.code).toBe("PDF_RENDERER_UNAVAILABLE");
  });

  it("never falls back to env identity values when the read fails", async () => {
    vi.stubEnv("EMPLOYER_NAME", "Some Other Deductor"); vi.stubEnv("EMPLOYER_TAN", "MUMD54321E"); vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "single-tenant");
    await expect(resolveDocIdentity("t-2", () => reply(false, {}))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });

  it("a failure is never cached; a success is", async () => {
    let calls = 0;
    const f: Fetch = () => { calls += 1; return calls === 1 ? reply(false, {}) : reply(true, { data: { name: "Office", settings: { documentIdentity: { tan: "delp12345c" } } } }); };
    await expect(resolveDocIdentity("t-3", f)).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
    expect((await resolveDocIdentity("t-3", f)).tan).toBe("DELP12345C");
    await resolveDocIdentity("t-3", f);
    expect(calls).toBe(2);
  });

  it("a successful read with no documentIdentity is a normal empty identity (name only)", async () => {
    const got = await resolveDocIdentity("t-4", () => reply(true, { data: { settings: {} } }));
    expect(got).toEqual(EMPTY_DOC_IDENTITY);
  });
});
