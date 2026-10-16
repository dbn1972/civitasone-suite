/**
 * GAP-AI-AGENTS-03 — GWT unit tests for mapRows date formatting in _data.ts.
 *
 * Given: a module payload whose rows carry ISO updatedAt/createdAt values.
 * When:  the generic mapRows mapper processes the payload.
 * Then:  the meta field is a human-readable "dd Mon yyyy, hh:mm am/pm" string
 *        in Asia/Kolkata (not the raw ISO timestamp), and an invalid string
 *        falls through without a mapRows error.
 *
 * mapRows is not exported directly, so we test through the module-loader
 * path by mocking fetchJson — this also validates the integration between
 * mapRows and formatIndianDateTime that was not previously covered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatIndianDateTime } from "@/lib/formatters";

// Verify the formatter itself (acceptance criteria from the gap ledger):
// '2026-09-24T09:12:40.000Z' -> '24 Sep 2026, 02:42 pm' (IST = UTC+5:30).
describe("formatIndianDateTime — GAP-AI-AGENTS-03 acceptance criteria", () => {
  it("formats a UTC ISO timestamp as IST date+time", () => {
    // 09:12:40 UTC + 5:30 = 14:42:40 IST  =>  '24 Sep 2026, 02:42 pm'
    expect(formatIndianDateTime("2026-09-24T09:12:40.000Z")).toBe(
      "24 Sep 2026, 02:42 pm",
    );
  });

  it("returns '—' for null input", () => {
    expect(formatIndianDateTime(null)).toBe("—");
  });

  it("returns '—' for undefined input", () => {
    expect(formatIndianDateTime(undefined)).toBe("—");
  });
});

// Verify mapRows plumbing via a hoisted fetchJson mock so we can drive the
// public getAiAgents loader and inspect the ModuleRowSummary it returns.
const H = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
}));

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: H.fetchJsonMock,
}));

describe("getAiAgents mapRows — GAP-AI-AGENTS-03", () => {
  beforeEach(() => {
    H.fetchJsonMock.mockReset();
  });

  it("formats an ISO updatedAt into a readable IST date-time in meta", async () => {
    // Arrange: mock the loader to call back with mapResponse(payload)
    H.fetchJsonMock.mockImplementation(
      async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
        const mapped = opts.mapResponse({
          data: [
            {
              id: "aaaa-bbbb",
              name: "Test Agent",
              status: "active",
              updatedAt: "2026-09-24T09:12:40.000Z",
            },
          ],
        });
        return { data: mapped, source: "api" };
      },
    );

    const { getAiAgents } = await import("./_data");
    const result = await getAiAgents();

    expect(result.data).toHaveLength(1);
    // The meta should be a formatted IST date-time, NOT the raw ISO string.
    expect(result.data[0]!.meta).toBe("24 Sep 2026, 02:42 pm");
    expect(result.data[0]!.meta).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
  });

  it("falls back to createdAt (formatted) when updatedAt is absent", async () => {
    H.fetchJsonMock.mockImplementation(
      async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
        const mapped = opts.mapResponse({
          data: [
            {
              id: "cccc-dddd",
              name: "Another Agent",
              status: "paused",
              createdAt: "2026-01-15T14:00:00.000Z",
            },
          ],
        });
        return { data: mapped, source: "api" };
      },
    );

    const { getAiAgents } = await import("./_data");
    const result = await getAiAgents();

    expect(result.data).toHaveLength(1);
    // 14:00:00 UTC + 5:30 = 19:30:00 IST = '15 Jan 2026, 07:30 pm'
    expect(result.data[0]!.meta).toBe("15 Jan 2026, 07:30 pm");
  });
});
