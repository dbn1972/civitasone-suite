import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mirror apiClient.test.ts / loaders.vigilance.test.ts: stub the server-only
// cookie reader + API base URL, then stub global fetch.
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { getInvestigations } from "./loaders";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

function investRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "i1",
    caseId: "INV-1",
    subject: "Subject",
    assignedTo: "officer-1",
    started: "2026-03-05",
    findings: "finding text",
    status: "in_progress",
    ...over,
  };
}

describe("getInvestigations mapResponse (GAP-AUDIT-INVESTIGATION-01/04)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  // GAP-AUDIT-INVESTIGATION-01
  it("a valid but EMPTY array stays source 'api' with data [] (fresh tenant), not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    const result = await getInvestigations();
    // Old code returned null → source:"error", making "No investigations found" unreachable.
    expect(result.source).toBe("api");
    expect(result.data).toEqual([]);
  });

  it("a 500 surfaces as source 'error' with empty data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" })));
    const result = await getInvestigations();
    expect(result.source).toBe("error");
    expect(result.data).toEqual([]);
  });

  it("rows that ALL drop (empty id) surface as an error, not 'empty'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [investRow({ id: "" })])));
    const result = await getInvestigations();
    expect(result.source).toBe("error");
    expect(result.data).toEqual([]);
  });

  // GAP-AUDIT-INVESTIGATION-04
  it("an unknown backend status becomes 'unknown', NOT 'in_progress'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [investRow({ status: "on_hold" })])));
    const result = await getInvestigations();
    expect(result.source).toBe("api");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("unknown");
    expect(result.data[0].status).not.toBe("in_progress");
  });

  it("known statuses pass through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, [
          investRow({ id: "a", status: "in_progress" }),
          investRow({ id: "b", status: "findings_submitted" }),
          investRow({ id: "c", status: "closed" }),
        ]),
      ),
    );
    const result = await getInvestigations();
    expect(result.data.map((r) => r.status)).toEqual(["in_progress", "findings_submitted", "closed"]);
  });
});
