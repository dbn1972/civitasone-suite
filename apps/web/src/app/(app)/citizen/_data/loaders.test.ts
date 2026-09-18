import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

describe("citizen loaders", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("calls the grievance detail endpoint with the right path and telemetry key", async () => {
    fetchJson.mockResolvedValue({ data: null, source: "api" });
    const { getGrievanceDetail } = await import("./loaders");
    await getGrievanceDetail("gr1");
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/v1/citizen/grievances/gr1",
      null,
      expect.objectContaining({ telemetryKey: "citizen.grievance.detail" }),
    );
  });

  it("maps a raw grievance payload into the Grievance shape", async () => {
    fetchJson.mockImplementation(async (_path, _empty, opts) => ({
      data: opts.mapResponse({
        id: "gr1",
        category: "sanitation",
        subject: "Garbage not collected",
        description: "5 days uncollected",
        priority: "high",
        status: "open",
        departmentRef: "Sanitation Dept",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        actions: [{ id: "ga1", actionType: "acknowledged", note: "noted", createdAt: "2024-01-02T00:00:00Z" }],
      }),
      source: "api",
    }));
    const { getGrievanceDetail } = await import("./loaders");
    const res = await getGrievanceDetail("gr1");
    expect(res.data).toEqual({
      id: "gr1",
      category: "sanitation",
      subject: "Garbage not collected",
      description: "5 days uncollected",
      priority: "high",
      status: "open",
      departmentRef: "Sanitation Dept",
      assignedTo: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      actions: [{ id: "ga1", actionType: "acknowledged", note: "noted", createdAt: "2024-01-02T00:00:00Z" }],
    });
  });

  it("maps a malformed/empty payload (e.g. the mock gateway's default {data: []} fallback) to null", async () => {
    fetchJson.mockImplementation(async (_path, _empty, opts) => ({
      data: opts.mapResponse({ data: [] }),
      source: "api",
    }));
    const { getGrievanceDetail } = await import("./loaders");
    const res = await getGrievanceDetail("unknown-id");
    expect(res.data).toBeNull();
  });

  it("propagates an error source from fetchJson unchanged", async () => {
    fetchJson.mockResolvedValue({ data: null, source: "error" });
    const { getGrievanceDetail } = await import("./loaders");
    const res = await getGrievanceDetail("gr1");
    expect(res.source).toBe("error");
    expect(res.data).toBeNull();
  });

  it("calls the rti detail endpoint with the right path and telemetry key", async () => {
    fetchJson.mockResolvedValue({ data: null, source: "api" });
    const { getRtiDetail } = await import("./loaders");
    await getRtiDetail("rti-001");
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/v1/citizen/rti/rti-001",
      null,
      expect.objectContaining({ telemetryKey: "citizen.rti.detail" }),
    );
  });

  it("maps a raw rti payload into the RtiDetail shape", async () => {
    fetchJson.mockImplementation(async (_path, _empty, opts) => ({
      data: opts.mapResponse({
        id: "rti-001",
        rtiNo: "RTI-001",
        subject: "Budget Expenditure Details FY 2024",
        description: "Seeking a breakdown of ward-level sanitation spend.",
        cpioRef: "CPIO-SANITATION-01",
        deadline: "2024-01-31T00:00:00Z",
        status: "received",
        statusLabel: "Received",
        isOverdue: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        responses: [{ id: "resp1", responseUrl: "https://example.gov.in/doc.pdf", respondedAt: "2024-01-20T00:00:00Z" }],
        appeals: [{ id: "ap1", appealType: "first", grounds: "Incomplete response", status: "pending", createdAt: "2024-01-25T00:00:00Z" }],
      }),
      source: "api",
    }));
    const { getRtiDetail } = await import("./loaders");
    const res = await getRtiDetail("rti-001");
    expect(res.data).toEqual({
      id: "rti-001",
      rtiNo: "RTI-001",
      subject: "Budget Expenditure Details FY 2024",
      description: "Seeking a breakdown of ward-level sanitation spend.",
      cpioRef: "CPIO-SANITATION-01",
      deadline: "2024-01-31T00:00:00Z",
      status: "received",
      statusLabel: "Received",
      isOverdue: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      responses: [{ id: "resp1", responseUrl: "https://example.gov.in/doc.pdf", respondedAt: "2024-01-20T00:00:00Z" }],
      appeals: [{ id: "ap1", appealType: "first", grounds: "Incomplete response", status: "pending", createdAt: "2024-01-25T00:00:00Z" }],
    });
  });

  it("maps a malformed/empty rti payload (e.g. the mock gateway's default {data: []} fallback) to null", async () => {
    fetchJson.mockImplementation(async (_path, _empty, opts) => ({
      data: opts.mapResponse({ data: [] }),
      source: "api",
    }));
    const { getRtiDetail } = await import("./loaders");
    const res = await getRtiDetail("unknown-id");
    expect(res.data).toBeNull();
  });

  it("propagates an error source from fetchJson unchanged for the rti loader", async () => {
    fetchJson.mockResolvedValue({ data: null, source: "error" });
    const { getRtiDetail } = await import("./loaders");
    const res = await getRtiDetail("rti-001");
    expect(res.source).toBe("error");
    expect(res.data).toBeNull();
  });
});
