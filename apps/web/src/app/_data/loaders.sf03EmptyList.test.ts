import { describe, it, expect, vi, beforeEach } from "vitest";

// SF-03 regression: a legitimately empty list must map to [] (rendered as the
// empty state), never null (fetchJson turns null into source:"error"). Only an
// unparseable payload, or rows that all fail to parse, may map to null.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import * as loaders from "./loaders";

type Mapper = (payload: unknown) => unknown;

async function mapperOf(call: () => Promise<unknown>): Promise<Mapper> {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
  await call();
  const opts = fetchJsonMock.mock.calls[0]![2] as { mapResponse: Mapper };
  return opts.mapResponse;
}

const GROUPS: Array<[string, () => Promise<unknown>]> = [
  // helpdesk / admin / tenant
  ["getHelpdeskMetrics", () => loaders.getHelpdeskMetrics()],
  ["getSlaRules", () => loaders.getSlaRules()],
  ["getTenantRoles", () => loaders.getTenantRoles()],
  ["getTenantSettings", () => loaders.getTenantSettings()],
  // hr / payroll
  ["getLeaveRequests", () => loaders.getLeaveRequests()],
  ["getAttendanceSummaries", () => loaders.getAttendanceSummaries()],
  ["getPayrollRuns", () => loaders.getPayrollRuns()],
  // finance
  ["getChartOfAccounts", () => loaders.getChartOfAccounts()],
  // crm
  ["getCrmContacts", () => loaders.getCrmContacts()],
  ["getCrmActivities", () => loaders.getCrmActivities()],
  ["getPipelines", () => loaders.getPipelines()],
  ["getPipelineDeals", () => loaders.getPipelineDeals()],
];

describe("SF-03: empty list is [] not null", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  for (const [name, call] of GROUPS) {
    describe(name, () => {
      it("maps an empty array payload to []", async () => {
        const map = await mapperOf(call);
        expect(map([])).toEqual([]);
      });

      it("maps an empty data envelope to []", async () => {
        const map = await mapperOf(call);
        expect(map({ data: [], pagination: { hasMore: false, pageSize: 50 } })).toEqual([]);
      });

      it("still returns null for a payload that is not a row list", async () => {
        const map = await mapperOf(call);
        expect(map("not-a-list")).toBeNull();
      });

      it("returns null when rows exist but none can be parsed", async () => {
        const map = await mapperOf(call);
        expect(map([null, 42])).toBeNull();
      });
    });
  }
});
