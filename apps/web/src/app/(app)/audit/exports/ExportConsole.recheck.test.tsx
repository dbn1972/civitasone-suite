import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ExportConsole } from "./ExportConsole";

const STATUS = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  data: {
    id, status, format: "json", ready: status === "completed", download: status === "completed" ? "tok" : null,
    rowCount: status === "completed" ? 42 : null, includesPii: false, retentionUntil: null, expiresAt: null, error: null,
    contentSha256: null, signature: null, signatureAlg: null, signingKeyId: null, signedAt: null, ...extra,
  },
});

async function generate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await waitFor(() => expect(screen.getByText("Generate signed audit export?")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
}

describe("ExportConsole re-check (GAP-AUDIT-EXPORTS-03 / 05 / 06)", () => {
  beforeEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("EXPORTS-03: verifying a completed export shows the integrity-verified result with hash and signature match", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/audit/exports") return new Response(JSON.stringify({ id: "exp-1", data: { id: "exp-1" } }), { status: 202 });
      if (url === "/api/proxy/v1/audit/exports/exp-1/verify") {
        return new Response(JSON.stringify({ data: { id: "exp-1", verified: true, contentMatch: true, signatureMatch: true, contentSha256: "abc123", signatureAlg: "HMAC-SHA256" } }), { status: 200 });
      }
      if (url.startsWith("/api/proxy/v1/audit/exports/exp-1")) return new Response(JSON.stringify(STATUS("exp-1", "completed", { contentSha256: "abc123" })), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ExportConsole />);
    await generate();
    fireEvent.click(await screen.findByRole("button", { name: "Verify integrity" }));
    expect(await screen.findByText("Integrity verified.")).toBeInTheDocument();
  });

  it("EXPORTS-05: starting job B after job A keeps B polling past A's 120s safety timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const polled: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/audit/exports") {
        n += 1;
        const id = n === 1 ? "job-A" : "job-B";
        return new Response(JSON.stringify({ id, data: { id } }), { status: 202 });
      }
      const m = url.match(/\/exports\/(job-[AB])$/);
      if (m) { polled.push(m[1]); return new Response(JSON.stringify(STATUS(m[1], "processing")), { status: 200 }); }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ExportConsole />);
    await generate();
    await waitFor(() => expect(polled).toContain("job-A"));
    // 100s later (A's safety stop at 120s is still pending) start job B.
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    await generate();
    await waitFor(() => expect(polled).toContain("job-B"));
    // A's original 120s deadline passes; B must still be polling.
    const before = polled.filter((p) => p === "job-B").length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const after = polled.filter((p) => p === "job-B").length;
    expect(after).toBeGreaterThan(before);
  });

  it("EXPORTS-06: no hard-coded hex colours remain in the exports folder sources", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(path.join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
