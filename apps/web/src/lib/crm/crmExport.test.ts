import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const downloadCsvFile = vi.fn();
const browserFetch = vi.fn();
vi.mock("@/lib/export/csvExport", () => ({ downloadCsvFile: (...a: unknown[]) => downloadCsvFile(...a) }));
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetch(...a),
  errorMessageFromResponse: vi.fn(async () => "export failed"),
}));

import { downloadServerCsv } from "./crmExport";

describe("downloadServerCsv filename stamp (CLOS2-S3-12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    downloadCsvFile.mockReset();
    browserFetch.mockReset();
    browserFetch.mockResolvedValue({ ok: true, text: async () => "a,b\n1,2\n" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the IST calendar date, not the UTC date, between 00:00 and 05:30 IST", async () => {
    // 2026-10-23 02:00 IST == 2026-10-22T20:30:00Z
    vi.setSystemTime(new Date("2026-10-22T20:30:00Z"));
    const r = await downloadServerCsv("/api/proxy/v1/crm/export", "audit review", {}, "contacts");
    expect(r.filename).toBe("contacts-2026-10-23.csv");
    expect(downloadCsvFile).toHaveBeenCalledWith("contacts-2026-10-23.csv", "a,b\n1,2\n");
  });
});
