import { describe, it, expect, vi, afterEach } from "vitest";
import { EXPORT_NOT_RECORDED, platformExportGuard, revealOnboardingContact } from "./platformExport";

afterEach(() => vi.restoreAllMocks());

describe("platformExportGuard", () => {
  it("posts the resource, row count and only a filtered flag (never the filter text)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    const v = await platformExportGuard("operators")({ rowCount: 7, filter: "  secret  " });
    expect(v).toEqual({ ok: true });
    expect(spy.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/platform-exports/audit");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ resource: "operators", rowCount: 7, filtered: true });
  });
  it("fails closed on a non-2xx and on a network error, with the same plain message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 403 }));
    expect(await platformExportGuard("onboarding")({ rowCount: 1, filter: "" })).toEqual({ ok: false, message: EXPORT_NOT_RECORDED });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    expect(await platformExportGuard("onboarding")({ rowCount: 1, filter: "" })).toEqual({ ok: false, message: EXPORT_NOT_RECORDED });
  });
});

describe("revealOnboardingContact", () => {
  it("returns the clear contact on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { contactName: "Jane Doe", contactEmail: "j@x.gov.in" } }), { status: 200 }));
    expect(await revealOnboardingContact("id-1", "support ticket")).toEqual({ ok: true, contactName: "Jane Doe", contactEmail: "j@x.gov.in" });
  });
  it("never returns a value on failure, and the message carries no status code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const r = await revealOnboardingContact("id-1", "support ticket");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/500/);
  });
  it("a malformed success body is a failure, not a half-revealed row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { contactName: "Jane" } }), { status: 200 }));
    expect((await revealOnboardingContact("id-1", "support ticket")).ok).toBe(false);
  });
});
