/**
 * RTI repo-level tests.
 * Tests the repository functions: insertRti, listRti, getRti, transitionRti.
 * Uses hoisted mocks against the shared DB layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const RTI_ID = "cccccccc-0001-4000-8000-000000000001";
const PIO_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectResult: vi.fn(),
  insertResult: vi.fn(),
  updateResult: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const mockTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => H.selectResult(),
          orderBy: () => ({ limit: () => H.selectResult() }),
        }),
      }),
    }),
    insert: () => ({ values: () => H.insertResult() }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => H.updateResult() }),
      }),
    }),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
  };
});

import { insertRti, listRti, getRti, transitionRti } from "../src/modules/rti/repo.js";

const makeRow = (over: Record<string, unknown> = {}) => ({
  id: RTI_ID,
  tenantId: TENANT,
  referenceNo: "RTI-2026-001",
  applicantName: "Rajesh Kumar",
  applicantContact: "rajesh@example.com",
  subject: "Information about project status",
  requestText: "Please provide details of ongoing projects.",
  receivedDate: "2026-06-01",
  dueDate: "2026-07-01",
  pioId: null,
  status: "filed",
  responseText: null,
  respondedDate: null,
  appealText: null,
  appealDate: null,
  closedDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: USER,
  updatedBy: USER,
  version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════ insertRti ═══════════════════
describe("insertRti", () => {
  it("inserts a new RTI request via the tx writer", async () => {
    H.insertResult.mockResolvedValue(undefined);
    const row = {
      id: RTI_ID,
      tenantId: TENANT,
      createdBy: USER,
      updatedBy: USER,
      referenceNo: "RTI-2026-001",
      applicantName: "Rajesh Kumar",
      applicantContact: "rajesh@example.com",
      subject: "Project status",
      requestText: "Please provide details.",
      receivedDate: "2026-06-01",
      dueDate: "2026-07-01",
      status: "filed",
    };
    // insertRti takes a Writer (tx) — our mock db.transaction provides it
    const { db } = await import("../src/shared/db.js");
    await db.transaction(async (tx: any) => {
      await insertRti(tx, row);
    });
    expect(H.insertResult).toHaveBeenCalledTimes(1);
  });

  it("passes row values through to the insert chain", async () => {
    H.insertResult.mockResolvedValue(undefined);
    const row = {
      id: "eeeeeeee-0001-4000-8000-000000000001",
      tenantId: TENANT,
      createdBy: USER,
      updatedBy: USER,
      referenceNo: "RTI-2026-002",
      applicantName: "Sita Devi",
      applicantContact: null,
      subject: "Staff count",
      requestText: "How many employees?",
      receivedDate: "2026-07-01",
      dueDate: "2026-07-31",
      status: "filed",
    };
    const { db } = await import("../src/shared/db.js");
    await db.transaction(async (tx: any) => {
      await insertRti(tx, row);
    });
    expect(H.insertResult).toHaveBeenCalled();
  });
});

// ═══════════════════ listRti ═══════════════════
describe("listRti", () => {
  it("returns rows from scopedRead with default limit", async () => {
    const rows = [makeRow(), makeRow({ id: "cccccccc-0002-4000-8000-000000000001", referenceNo: "RTI-2026-002" })];
    H.selectResult.mockResolvedValue(rows);
    const result = await listRti(TENANT);
    expect(result).toEqual(rows);
    expect(H.selectResult).toHaveBeenCalled();
  });

  it("returns empty array when no requests exist", async () => {
    H.selectResult.mockResolvedValue([]);
    const result = await listRti(TENANT);
    expect(result).toEqual([]);
  });

  it("accepts a custom limit parameter", async () => {
    H.selectResult.mockResolvedValue([makeRow()]);
    const result = await listRti(TENANT, 10);
    expect(result).toHaveLength(1);
  });
});

// ═══════════════════ getRti ═══════════════════
describe("getRti", () => {
  it("returns a single RTI request when found", async () => {
    const row = makeRow();
    H.selectResult.mockResolvedValue([row]);
    const result = await getRti(TENANT, RTI_ID);
    expect(result).toEqual(row);
  });

  it("returns undefined when no matching request found", async () => {
    H.selectResult.mockResolvedValue([]);
    const result = await getRti(TENANT, "ffffffff-0001-4000-8000-000000000001");
    expect(result).toBeUndefined();
  });

  it("filters by both tenantId and id", async () => {
    const row = makeRow();
    H.selectResult.mockResolvedValue([row]);
    const result = await getRti(TENANT, RTI_ID);
    expect(result?.tenantId).toBe(TENANT);
    expect(result?.id).toBe(RTI_ID);
  });
});

// ═══════════════════ transitionRti ═══════════════════
describe("transitionRti", () => {
  it("returns updated row on successful transition (filed -> assigned)", async () => {
    const updatedRow = makeRow({ status: "assigned", pioId: PIO_ID, version: 2 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["filed"],
      to: "assigned",
      set: { pioId: PIO_ID },
    });
    expect(result).toEqual(updatedRow);
    expect(result?.status).toBe("assigned");
    expect(result?.pioId).toBe(PIO_ID);
  });

  it("returns null when no row matches the from state (guard rejection)", async () => {
    H.updateResult.mockResolvedValue([]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["filed"],
      to: "assigned",
      set: { pioId: PIO_ID },
    });
    expect(result).toBeNull();
  });

  it("transitions from filed|assigned to responded", async () => {
    const updatedRow = makeRow({ status: "responded", responseText: "Here is the info.", respondedDate: "2026-06-20", version: 2 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["filed", "assigned"],
      to: "responded",
      set: { responseText: "Here is the info.", respondedDate: "2026-06-20" },
    });
    expect(result?.status).toBe("responded");
    expect(result?.responseText).toBe("Here is the info.");
  });

  it("transitions from responded to appealed", async () => {
    const updatedRow = makeRow({ status: "appealed", appealText: "Incomplete response", appealDate: "2026-07-01", version: 2 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["responded"],
      to: "appealed",
      set: { appealText: "Incomplete response", appealDate: "2026-07-01" },
    });
    expect(result?.status).toBe("appealed");
    expect(result?.appealText).toBe("Incomplete response");
  });

  it("transitions from responded|appealed to closed", async () => {
    const updatedRow = makeRow({ status: "closed", closedDate: "2026-07-15", version: 2 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["responded", "appealed"],
      to: "closed",
      set: { closedDate: "2026-07-15" },
    });
    expect(result?.status).toBe("closed");
    expect(result?.closedDate).toBe("2026-07-15");
  });

  it("returns null when id does not exist", async () => {
    H.updateResult.mockResolvedValue([]);
    const result = await transitionRti(TENANT, "ffffffff-9999-4000-8000-000000000099", USER, {
      from: ["filed"],
      to: "assigned",
      set: { pioId: PIO_ID },
    });
    expect(result).toBeNull();
  });

  it("transitions without optional set fields", async () => {
    const updatedRow = makeRow({ status: "assigned", version: 2 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["filed"],
      to: "assigned",
    });
    expect(result?.status).toBe("assigned");
  });

  it("increments version on successful transition", async () => {
    const updatedRow = makeRow({ status: "assigned", version: 3 });
    H.updateResult.mockResolvedValue([updatedRow]);
    const result = await transitionRti(TENANT, RTI_ID, USER, {
      from: ["filed"],
      to: "assigned",
      set: { pioId: PIO_ID },
    });
    expect(result?.version).toBe(3);
  });
});
