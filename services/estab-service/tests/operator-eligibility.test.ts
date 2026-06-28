import { describe, it, expect, vi, beforeEach } from "vitest";

const desksByKey = new Map<string, unknown[]>();

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (tenantId: string, resource: string, id: string) => `${tenantId}:${resource}:${id}`,
    getOrLoad: async <T,>(key: string, loader: () => Promise<T>) => {
      if (desksByKey.has(key)) return desksByKey.get(key) as T;
      return loader();
    },
    invalidate: async () => {},
  },
}));
vi.mock("../src/shared/db.js", () => ({ db: {} }));

const T = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

function desk(over: Record<string, unknown>) {
  return {
    id: "d", tenantId: T, employeeId: EMP, division: "PWD", section: null,
    deskRole: "dealing_hand", canInitiate: true, active: true, assignedBy: T,
    createdAt: new Date(), updatedAt: new Date(), createdBy: T, updatedBy: T, version: 1,
    ...over,
  };
}

let checkEligibility: typeof import("../src/modules/operators/eligibility.js").checkEligibility;
let isActiveOperator: typeof import("../src/modules/operators/eligibility.js").isActiveOperator;

beforeEach(async () => {
  desksByKey.clear();
  ({ checkEligibility, isActiveOperator } = await import("../src/modules/operators/eligibility.js"));
});

describe("operator eligibility", () => {
  it("non-enrolled employee is not eligible", async () => {
    desksByKey.set(`${T}:operator:${EMP}`, []);
    expect(await isActiveOperator(T, EMP)).toBe(false);
  });

  it("enrolled operator is eligible to hold files", async () => {
    desksByKey.set(`${T}:operator:${EMP}`, [desk({})]);
    expect(await isActiveOperator(T, EMP)).toBe(true);
  });

  it("scopes eligibility to a division", async () => {
    desksByKey.set(`${T}:operator:${EMP}`, [desk({ division: "PWD" })]);
    expect(await isActiveOperator(T, EMP, "PWD")).toBe(true);
    expect(await isActiveOperator(T, EMP, "Health")).toBe(false);
  });

  it("requireInitiate fails when no desk can initiate", async () => {
    desksByKey.set(`${T}:operator:${EMP}`, [desk({ canInitiate: false })]);
    const e = await checkEligibility(T, EMP, { requireInitiate: true });
    expect(e.eligible).toBe(false);
    expect(e.canInitiate).toBe(false);
  });
});
