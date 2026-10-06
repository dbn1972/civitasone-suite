import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mirror the fetch-mocking convention used by apiClient.test.ts: stub the
// server-only cookie reader and the API base URL, then stub global fetch.
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { getVigilanceCases } from "./loaders";

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

describe("getVigilanceCases mapResponse (GAP-AUDIT-VIGILANCE-01)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("a valid but EMPTY array is an empty register (source 'api', data []), not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));

    const result = await getVigilanceCases();

    // On the old `mapped.length > 0 ? mapped : null` code this came back as
    // source:"error", making the "No vigilance cases found" state unreachable.
    expect(result.source).toBe("api");
    expect(result.data).toEqual([]);
  });

  it("rows that ALL drop (empty id) surface as an error, so a schema break is not hidden as 'empty'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, [
          { id: "", caseNo: "VC-1", officer: "A", charges: "x", inquiryStatus: "preliminary_enquiry", outcome: "pending" },
        ]),
      ),
    );

    const result = await getVigilanceCases();

    expect(result.source).toBe("error");
    expect(result.data).toEqual([]);
  });

  it("keeps the valid rows when some are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, [
          { id: "v1", caseNo: "VC-1", officer: "A", charges: "x", inquiryStatus: "under_investigation", outcome: "pending" },
        ]),
      ),
    );

    const result = await getVigilanceCases();

    expect(result.source).toBe("api");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("v1");
  });
});
