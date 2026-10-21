import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * GAP-CRM-VOICE-OF-CUSTOMER-01 - getCrmSentimentSummary forwards the chosen window to
 * crm-service as the `from` / `to` query parameters, unchanged. (The page, not the loader, turns
 * the picked calendar days into the ISO instants the server requires; this pins the wire.)
 */
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));

import { getCrmSentimentSummary } from "./loaders";

const BODY = {
  data: {
    total: 12,
    byPolarity: { positive: 6, neutral: 3, negative: 3 },
    averageScore: 20,
    negativeShare: 25,
    topThemes: [{ theme: "delay", count: 5, negativeCount: 3 }],
    truncated: true,
  },
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body), clone() { return ok(body); } } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockGet.mockReturnValue({ value: "fake-access-token" });
  process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  fetchMock = vi.fn().mockResolvedValue(ok(BODY));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CIVITASONE_API_BASE_URL;
});

function requested(): URL {
  return new URL(String(fetchMock.mock.calls[0]![0]));
}

describe("getCrmSentimentSummary window (GAP-CRM-VOICE-OF-CUSTOMER-01)", () => {
  it("fetches the whole aggregate when no window is given", async () => {
    const r = await getCrmSentimentSummary();
    expect(requested().pathname).toBe("/api/v1/crm/sentiment/summary");
    expect(requested().search).toBe("");
    expect(r.source).toBe("api");
    expect(r.data.total).toBe(12);
    expect(r.data.truncated).toBe(true);
  });

  it("sends from and to as query parameters, exactly as given", async () => {
    await getCrmSentimentSummary({ from: "2026-08-31T18:30:00.000Z", to: "2026-09-30T18:29:59.999Z" });
    const u = requested();
    expect(u.pathname).toBe("/api/v1/crm/sentiment/summary");
    expect(u.searchParams.get("from")).toBe("2026-08-31T18:30:00.000Z");
    expect(u.searchParams.get("to")).toBe("2026-09-30T18:29:59.999Z");
  });

  it("sends only the side it was given", async () => {
    await getCrmSentimentSummary({ from: "2026-08-31T18:30:00.000Z" });
    expect(requested().searchParams.has("from")).toBe(true);
    expect(requested().searchParams.has("to")).toBe(false);
  });

  it("gates a failed fetch as an error, not a zero aggregate dressed up as fact", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({}), clone() { return this; } });
    const r = await getCrmSentimentSummary({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.source).toBe("error");
  });
});
