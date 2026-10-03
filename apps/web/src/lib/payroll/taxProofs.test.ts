import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetch(...a),
  errorCodeFromResponse: async (res: Response) => {
    try { return ((await res.clone().json()) as { code?: string }).code ?? null; } catch { return null; }
  },
}));

import {
  validateProofFile, errorKeyForCode, isEmptyList, isLineFull, itemsForLine, recentFinancialYears, formatBytes,
  uploadProof, openProof, hasAnyRole, TAX_PROOF_VIEWER_ROLES, TAX_PROOF_DECIDER_ROLES, TAX_PROOF_HOLD_ROLES,
  TAX_PROOF_RETENTION_ROLES, PROOF_MAX_BYTES, type ProofItem,
} from "./taxProofs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = (over: Partial<ProofItem> = {}): ProofItem => ({
  id: "p1", line: "sec80c", fy: "2025-26", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10, amountMinor: null,
  status: "pending", rejectionReason: null, createdAt: "2026-01-01T00:00:00Z", decidedAt: null, ...over,
});

beforeEach(() => browserFetch.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("role sets mirror payroll-service", () => {
  it("never admit hr, manager or finance", () => {
    for (const r of ["hr_admin", "hr_officer", "manager", "finance_officer", "employee"]) {
      expect(TAX_PROOF_VIEWER_ROLES).not.toContain(r);
    }
    expect(TAX_PROOF_DECIDER_ROLES).toEqual(["payroll_officer", "payroll_admin"]);
    expect(TAX_PROOF_VIEWER_ROLES).toContain("auditor");
    expect(TAX_PROOF_DECIDER_ROLES).not.toContain("auditor");
    expect(TAX_PROOF_HOLD_ROLES).toEqual(["payroll_admin"]);
    expect(TAX_PROOF_RETENTION_ROLES).toEqual(["payroll_admin", "tenant_admin", "super_admin"]);
    expect(hasAnyRole(["auditor"], TAX_PROOF_VIEWER_ROLES)).toBe(true);
    expect(hasAnyRole(["hr_admin"], TAX_PROOF_VIEWER_ROLES)).toBe(false);
  });
});

describe("file pre-checks", () => {
  it("accepts PDF/JPEG/PNG within 10 MB and refuses the rest", () => {
    expect(validateProofFile({ size: 1000, type: "application/pdf" })).toBe("ok");
    expect(validateProofFile({ size: PROOF_MAX_BYTES, type: "image/png" })).toBe("ok");
    expect(validateProofFile({ size: PROOF_MAX_BYTES + 1, type: "image/jpeg" })).toBe("size");
    expect(validateProofFile({ size: 10, type: "application/zip" })).toBe("type");
    expect(validateProofFile({ size: 0, type: "application/pdf" })).toBe("empty");
  });
});

describe("helpers", () => {
  it("maps known server codes to copy keys and leaves the rest generic", () => {
    expect(errorKeyForCode("SELF_VERIFY_FORBIDDEN")).toBe("selfVerify");
    expect(errorKeyForCode("PROOF_TOO_LARGE")).toBe("tooLarge");
    expect(errorKeyForCode("SOMETHING_ELSE")).toBeNull();
    expect(errorKeyForCode(null)).toBeNull();
  });
  it("detects empty lists and full lines", () => {
    expect(isEmptyList([])).toBe(true);
    expect(isEmptyList(null)).toBe(true);
    expect(isEmptyList([1])).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => item({ id: `p${i}` }));
    expect(isLineFull(undefined, ten, "sec80c")).toBe(true);
    expect(isLineFull(undefined, ten, "rent")).toBe(false);
    expect(itemsForLine([item(), item({ id: "p2", line: "rent" })], "rent")).toHaveLength(1);
  });
  it("lists recent financial years newest first and formats sizes", () => {
    expect(recentFinancialYears("2026-27", 3)).toEqual(["2026-27", "2025-26", "2024-25"]);
    expect(recentFinancialYears("2099-00", 2)).toEqual(["2099-00", "2098-99"]);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("uploadProof", () => {
  const file = new File(["%PDF"], "rent.pdf", { type: "application/pdf" });

  it("presigns, PUTs with exactly the signed headers (incl. SSE), then attaches", async () => {
    browserFetch
      .mockResolvedValueOnce(json({ storageKey: "payroll/t/tax-proofs/2025-26/e/u.pdf", uploadUrl: "https://s3.test/put", headers: { "content-type": "application/pdf", "x-amz-server-side-encryption": "AES256" } }))
      .mockResolvedValueOnce(json({ id: "x", status: "accepted" }, 202));
    const put = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", put);
    const out = await uploadProof({ fy: "2025-26", line: "rent", file, amountMinor: "120000" });
    expect(out).toEqual({ ok: true });
    expect(put).toHaveBeenCalledWith("https://s3.test/put", expect.objectContaining({ method: "PUT", headers: { "content-type": "application/pdf", "x-amz-server-side-encryption": "AES256" }, body: file }));
    const attach = JSON.parse((browserFetch.mock.calls[1]![1] as { body: string }).body);
    expect(attach).toEqual({ fy: "2025-26", line: "rent", storageKey: "payroll/t/tax-proofs/2025-26/e/u.pdf", filename: "rent.pdf", amountMinor: 120000 });
  });

  it("returns the server code when presign or attach is refused, and UPLOAD_FAILED when storage refuses", async () => {
    browserFetch.mockResolvedValueOnce(json({ code: "PROOF_LIMIT_REACHED" }, 409));
    expect(await uploadProof({ fy: "2025-26", line: "rent", file })).toEqual({ ok: false, code: "PROOF_LIMIT_REACHED" });

    browserFetch.mockResolvedValueOnce(json({ storageKey: "k", uploadUrl: "https://s3.test/put", headers: {} }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    expect(await uploadProof({ fy: "2025-26", line: "rent", file })).toEqual({ ok: false, code: "UPLOAD_FAILED" });

    browserFetch.mockResolvedValueOnce(json({ storageKey: "k", uploadUrl: "https://s3.test/put", headers: {} }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    browserFetch.mockResolvedValueOnce(json({ code: "INVALID_STORAGE_KEY" }, 422));
    expect(await uploadProof({ fy: "2025-26", line: "rent", file })).toEqual({ ok: false, code: "INVALID_STORAGE_KEY" });
  });
});

describe("openProof", () => {
  it("opens the short-lived link in a new tab without opener access", async () => {
    browserFetch.mockResolvedValueOnce(json({ url: "https://s3.test/get?e=300" }));
    const open = vi.fn();
    vi.stubGlobal("open", open);
    expect(await openProof("abc")).toEqual({ ok: true });
    expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/abc/url");
    expect(open).toHaveBeenCalledWith("https://s3.test/get?e=300", "_blank", "noopener,noreferrer");
  });
  it("does not open anything when the link is refused", async () => {
    browserFetch.mockResolvedValueOnce(json({ code: "FORBIDDEN" }, 403));
    const open = vi.fn();
    vi.stubGlobal("open", open);
    expect(await openProof("abc")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(open).not.toHaveBeenCalled();
  });
});
