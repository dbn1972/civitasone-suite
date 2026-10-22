import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, fetchJson: (...a: unknown[]) => fetchJsonMock(...a) };
});

import { getEmployeeById } from "./loaders";

describe("getEmployeeById caching (GAP-HR-EMPLOYEES-DETAIL-EDIT-06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });
  });

  it("keeps the 60 s data cache by default", async () => {
    await getEmployeeById("e1");
    const [url, , opts] = fetchJsonMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/hrms/employees/e1");
    expect(opts.revalidateSeconds).toBe(60);
  });

  it("skips the data cache entirely for a fresh read (apiClient turns a missing revalidate into no-store)", async () => {
    await getEmployeeById("e1", { fresh: true });
    const [, , opts] = fetchJsonMock.mock.calls[0]!;
    expect(opts.revalidateSeconds).toBeUndefined();
    expect("revalidateSeconds" in opts).toBe(false);
    expect(opts.telemetryKey).toBe("hr.employee.detail");
  });

  it("treats fresh:false like the default", async () => {
    await getEmployeeById("e1", { fresh: false });
    expect(fetchJsonMock.mock.calls[0]![2].revalidateSeconds).toBe(60);
  });
});
