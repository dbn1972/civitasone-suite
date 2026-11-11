/**
 * PR #2463 delta: the Form 16 / 12BA deductor comes from the tenant document identity (tenant-service). A tenant-service
 * failure is a TenantIdentityUnavailableError (503 at the routes), and the deploy-level EMPLOYER_* values built into the
 * form are used only on an explicitly single-tenant deployment (PAYROLL_DEDUCTOR_ENV_FALLBACK=single-tenant).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentNotIssuableError, TenantIdentityUnavailableError, resetDocIdentityCache } from "@civitasone/render/official";
import { resolveForm16Deductor } from "../src/modules/form16-pdf/form16-document.js";

const T = "aaaaaaaa-1111-4000-8000-0000000d0f16";
const BUILT = { name: "Deployment Default Office", tan: "MUMD54321E", pan: "AAACD5432L" };
const tenantReply = (r: () => Response | Promise<Response>) => vi.stubGlobal("fetch", vi.fn(async () => r()));

beforeEach(() => { resetDocIdentityCache(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetDocIdentityCache(); });

describe("resolveForm16Deductor fails closed", () => {
  it.each([
    ["500", () => new Response("{}", { status: 500 })],
    ["connection error", () => { throw new TypeError("fetch failed"); }],
    ["bad body", () => new Response("null", { status: 200 })],
  ] as const)("tenant-service %s -> TenantIdentityUnavailableError even with a valid built-form deductor and the single-tenant flag", async (_n, r) => {
    vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "single-tenant");
    tenantReply(r);
    await expect(resolveForm16Deductor(T, BUILT)).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });

  it("no documentIdentity on a multi-tenant deployment: the built-form (EMPLOYER_*) deductor is NOT used -> not configured", async () => {
    vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "");
    tenantReply(() => new Response(JSON.stringify({ data: { settings: {} } }), { status: 200 }));
    const err = await resolveForm16Deductor(T, BUILT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocumentNotIssuableError);
    expect(JSON.stringify(err)).not.toContain("MUMD54321E");
  });

  it("explicit single-tenant flag: the built-form deductor is the fallback for a successful read with no identity", async () => {
    vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "single-tenant");
    tenantReply(() => new Response(JSON.stringify({ data: { settings: {} } }), { status: 200 }));
    await expect(resolveForm16Deductor(T, BUILT)).resolves.toMatchObject({ name: BUILT.name, tan: BUILT.tan, pan: BUILT.pan });
  });

  it("the tenant's own documentIdentity always wins", async () => {
    vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "");
    tenantReply(() => new Response(JSON.stringify({ data: { settings: { documentIdentity: { orgName: "Office A", tan: "DELP12345C", pan: "AAAGP1234K" } } } }), { status: 200 }));
    await expect(resolveForm16Deductor(T, BUILT)).resolves.toMatchObject({ name: "Office A", tan: "DELP12345C", pan: "AAAGP1234K" });
  });
});
