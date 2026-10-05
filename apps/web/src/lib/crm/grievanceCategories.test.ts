import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as gc from "./grievanceCategories";

function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const row = { id: "g1", code: "water_supply", label: "Water Supply", active: true, sortOrder: 1, version: 1 };

describe("grievanceCategories HTTP client (GAP-CRM-GRIEVANCES-NEW-03)", () => {
  it("getGrievanceCategories parses the API list and gates errors", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [row] }));
    const ok = await gc.getGrievanceCategories();
    expect(ok.source).toBe("api");
    expect(ok.data[0].code).toBe("water_supply");

    fetchMock.mockResolvedValueOnce(res({}, { status: 503 }));
    const err = await gc.getGrievanceCategories();
    expect(err.source).toBe("error");
    expect(err.data).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await gc.getGrievanceCategories()).source).toBe("error");
  });

  it("grievanceCategoryOptions uses active tenant categories sorted by order when present", () => {
    const options = gc.grievanceCategoryOptions({
      source: "api",
      data: [
        { code: "b", label: "Beta", active: true, sortOrder: 2 },
        { code: "a", label: "Alpha", active: true, sortOrder: 1 },
        { code: "c", label: "Gamma", active: false, sortOrder: 0 },
      ],
    });
    expect(options.fellBack).toBe(false);
    expect(options.labels).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to the default CPGRAMS list when none configured", () => {
    const empty = gc.grievanceCategoryOptions({ source: "api", data: [] });
    expect(empty.fellBack).toBe(true);
    expect(empty.labels).toEqual(gc.DEFAULT_GRIEVANCE_CATEGORIES.map((c) => c.label));
    expect(empty.labels).toContain("Water Supply");
  });

  it("falls back when the load errored (never fabricates an empty select)", () => {
    const errored = gc.grievanceCategoryOptions({ source: "error", data: [] });
    expect(errored.fellBack).toBe(true);
    expect(errored.labels.length).toBe(gc.DEFAULT_GRIEVANCE_CATEGORIES.length);
  });

  it("validateGrievanceCategory rejects bad code / blank label and accepts a good row", () => {
    expect(gc.validateGrievanceCategory({ code: "Water Supply", label: "x", active: true, sortOrder: 0 }).code).toBeTruthy();
    expect(gc.validateGrievanceCategory({ code: "ok_code", label: "", active: true, sortOrder: 0 }).label).toBeTruthy();
    expect(gc.isGrievanceCategoryValid({ code: "ok_code", label: "OK", active: true, sortOrder: 0 })).toBe(true);
  });

  it("createGrievanceCategory POSTs the proxied endpoint; non-ok throws", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: row }, { status: 202 }));
    await gc.createGrievanceCategory({ code: "water_supply", label: "Water Supply", active: true, sortOrder: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/grievance-categories");
    expect((init as RequestInit).method).toBe("POST");

    fetchMock.mockResolvedValueOnce(res({ code: "CONFLICT" }, { status: 409 }));
    await expect(
      gc.createGrievanceCategory({ code: "water_supply", label: "dup", active: true, sortOrder: 0 }),
    ).rejects.toThrow();
  });
});
