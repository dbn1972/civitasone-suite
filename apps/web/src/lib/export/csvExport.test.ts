import { describe, it, expect, vi, afterEach } from "vitest";
import { tableExportGuard, runAuditedCsvExport, postExportAudit, downloadCsvFile, TABLE_EXPORT_NOT_RECORDED } from "./csvExport";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("tableExportGuard (fail-closed audit)", () => {
  it("posts resource, rowCount and filtered (never the raw filter text) and resolves ok on 2xx", async () => {
    const f = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", f);
    expect(await tableExportGuard("hr/transfer")({ rowCount: 3, filter: "  secret  " })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/proxy/v1/admin/table-exports/audit");
    expect(JSON.parse(init.body)).toEqual({ resource: "hr/transfer", rowCount: 3, filtered: true });
    expect(init.body).not.toContain("secret");
  });
  it("non-2xx, network failure and a malformed resource key are all not-ok (and a bad key never calls the network)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 }) as Response));
    expect(await tableExportGuard("a/b")({ rowCount: 1, filter: "" })).toEqual({ ok: false, message: TABLE_EXPORT_NOT_RECORDED });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await tableExportGuard("a/b")({ rowCount: 1, filter: "" })).ok).toBe(false);
    const never = vi.fn();
    vi.stubGlobal("fetch", never);
    expect((await tableExportGuard("../etc")({ rowCount: 1, filter: "" })).ok).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("postExportAudit", () => {
  it("maps a 2xx to ok and anything else to not-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
    expect(await postExportAudit("/x", { rowCount: 1 })).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    expect((await postExportAudit("/x", { rowCount: 1 })).ok).toBe(false);
  });
});

describe("runAuditedCsvExport", () => {
  it("audits BEFORE building and downloading", async () => {
    const order: string[] = [];
    URL.createObjectURL = vi.fn(() => { order.push("download"); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    const v = await runAuditedCsvExport({
      guard: async () => { order.push("audit"); return { ok: true }; },
      rowCount: 2, filename: "f.csv", build: () => { order.push("build"); return "a,b"; },
    });
    expect(v).toEqual({ ok: true });
    expect(order).toEqual(["audit", "build", "download"]);
  });
  it("a failed (or throwing) audit blocks the file: build is never called", async () => {
    const build = vi.fn(() => "a");
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    expect(await runAuditedCsvExport({ guard: async () => ({ ok: false, message: "nope" }), rowCount: 1, filename: "f.csv", build })).toEqual({ ok: false, message: "nope" });
    expect((await runAuditedCsvExport({ guard: async () => { throw new Error("x"); }, rowCount: 1, filename: "f.csv", build })).ok).toBe(false);
    expect(build).not.toHaveBeenCalled();
    expect(made).not.toHaveBeenCalled();
  });
});

describe("downloadCsvFile", () => {
  it("builds a text/csv blob and names the file", () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    downloadCsvFile("x.csv", "a,b");
    expect(blobs[0]!.type).toContain("text/csv");
    expect(click).toHaveBeenCalled();
  });
});
