import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as st from "./serviceTypes";

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

const row = { id: "s1", code: "ration_card", label: "Ration Card", active: true, sortOrder: 2, version: 1 };

describe("serviceTypes HTTP client (GAP-CRM-SERVICE-REQUESTS-NEW-02)", () => {
  it("getServiceTypes parses the API list and gates errors", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [row] }));
    const ok = await st.getServiceTypes();
    expect(ok.source).toBe("api");
    expect(ok.data).toHaveLength(1);
    expect(ok.data[0].code).toBe("ration_card");

    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    const err = await st.getServiceTypes();
    expect(err.source).toBe("error");
    expect(err.data).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await st.getServiceTypes()).source).toBe("error");
  });

  it("serviceTypeOptions uses active tenant types sorted by order when present", () => {
    const options = st.serviceTypeOptions({
      source: "api",
      data: [
        { code: "b", label: "Beta", active: true, sortOrder: 2 },
        { code: "a", label: "Alpha", active: true, sortOrder: 1 },
        { code: "c", label: "Gamma", active: false, sortOrder: 0 },
      ],
    });
    expect(options.fellBack).toBe(false);
    expect(options.labels).toEqual(["Alpha", "Beta"]); // inactive 'Gamma' excluded, sorted by order
  });

  it("falls back to the labelled default list when no active types are configured", () => {
    const empty = st.serviceTypeOptions({ source: "api", data: [] });
    expect(empty.fellBack).toBe(true);
    expect(empty.labels).toEqual(st.DEFAULT_SERVICE_TYPES.map((t) => t.label));
    expect(empty.labels).toContain("Birth Certificate");
  });

  it("falls back when the load errored (never fabricates an empty select)", () => {
    const errored = st.serviceTypeOptions({ source: "error", data: [] });
    expect(errored.fellBack).toBe(true);
    expect(errored.labels.length).toBe(st.DEFAULT_SERVICE_TYPES.length);
  });

  it("validateServiceType rejects bad code / blank label and accepts a good row", () => {
    expect(st.validateServiceType({ code: "Ration Card", label: "x", active: true, sortOrder: 0 }).code).toBeTruthy();
    expect(st.validateServiceType({ code: "ok_code", label: "", active: true, sortOrder: 0 }).label).toBeTruthy();
    expect(st.isServiceTypeValid({ code: "ok_code", label: "OK", active: true, sortOrder: 0 })).toBe(true);
  });

  it("createServiceType POSTs the proxied endpoint; non-ok throws", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: row }, { status: 202 }));
    await st.createServiceType({ code: "ration_card", label: "Ration Card", active: true, sortOrder: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/service-types");
    expect((init as RequestInit).method).toBe("POST");

    fetchMock.mockResolvedValueOnce(res({ code: "CONFLICT" }, { status: 409 }));
    await expect(
      st.createServiceType({ code: "ration_card", label: "dup", active: true, sortOrder: 0 }),
    ).rejects.toThrow();
  });
});
