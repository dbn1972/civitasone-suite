import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: fetchJsonMock }));

import { getMedicalInsurance } from "./insuranceData";

/** Run the loader's own mapResponse against a wire payload, as fetchJson would. */
function answerWith(payload: unknown) {
  fetchJsonMock.mockImplementation(async (...args: unknown[]) => {
    const [, empty, opts] = args as [string, unknown, { mapResponse: (p: unknown) => unknown }];
    const mapped = opts.mapResponse(payload);
    return mapped === null ? { data: empty, source: "error", status: 200 } : { data: mapped, source: "api" };
  });
}

describe("getMedicalInsurance", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("200 { data: null } is 'no record on file' (source api, data null), not a failed read", async () => {
    answerWith({ data: null });
    expect(await getMedicalInsurance("e1")).toEqual({ data: null, source: "api" });
  });

  it("a present record is returned mapped", async () => {
    answerWith({ data: { employee_id: "e1", scheme_type: "cghs", dependants: [] } });
    const r = await getMedicalInsurance("e1");
    expect(r.source).toBe("api");
    expect(r.data).toMatchObject({ employeeId: "e1", schemeType: "cghs" });
  });

  it("a malformed payload is still an error, never 'no record'", async () => {
    answerWith({ nope: true });
    expect((await getMedicalInsurance("e1")).source).toBe("error");
  });

  it("a genuine server error stays an error; a legacy 404 is still 'no record'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    expect((await getMedicalInsurance("e1")).source).toBe("error");
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 404 });
    expect(await getMedicalInsurance("e1")).toEqual({ data: null, source: "api", status: 404 });
  });
});
