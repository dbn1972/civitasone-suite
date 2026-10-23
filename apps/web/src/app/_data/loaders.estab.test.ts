/**
 * Estab loaders, from the wire up (W2 estab rescan, cluster 02).
 *
 *  GAP-ESTAB-FILES-DETAIL-05/06  getEstabFileById runs the REAL response through EstabFileDetailSchema
 *      and mapEstabFileDetail. The payload below is shaped like estab-service's FileDetailDto
 *      (services/estab-service/src/modules/files/queries.ts; the service's own real-DB contract test
 *      parses its live output with the same schema). The schema used to demand fields the service
 *      never sends (createdBy, createdDate), reject "public"/"closed", and refuse a null officer
 *      name, so every real file failed the gate and the page showed its load error; and it stripped
 *      noteType / noteStatus / eSigned / signedAt / dakNo / dueBy / movementHistory.
 *  GAP-ESTAB-DASHBOARD-05  the dashboard's openFiles / oldestPendencyDays survive the schema and mapper.
 *  GAP-ESTAB-FILES-DETAIL-01  a closed file stays "closed" in the register (it was folded into "active").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { getEstabFileById, getEstabDashboard, getEstabFiles } from "./loaders";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

const FILE_ID = "11111111-1111-4111-8111-111111111111";

/** FileDetailDto as the service sends it: nulls where an officer name is unresolved, raw status/classification. */
const dto = (over: Record<string, unknown> = {}) => ({
  id: FILE_ID, fileNo: "ESTAB-A/00007/2026", subject: "Pay revision proposal", dept: "ADMIN", department: "ADMIN",
  classification: "public", currentWith: "22222222-2222-4222-8222-222222222222", currentHolder: null,
  status: "closed", fileType: "main", volumeNo: 1, partNo: null, parentFileId: null, linkedFileIds: [],
  dakNo: "DAK/2026/114", inwardId: null, dueBy: "2026-10-10T00:00:00.000Z", createdAt: "2026-09-01T05:00:00.000Z",
  noteSheets: [
    { id: "n1", author: null, content: "Draft proposal.", timestamp: "2026-09-18T08:00:00.000Z", type: "note", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null },
    { id: "n2", author: "Anita Desai", content: "Approved.", timestamp: "2026-09-20T09:30:00.000Z", type: "order", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-20T09:35:00.000Z" },
  ],
  movementHistory: [
    { id: "m1", fromOfficerId: null, toOfficerId: "22222222-2222-4222-8222-222222222222", action: "forward", remarks: "For comment", movedAt: "2026-09-19T10:00:00.000Z" },
    { id: "m2", fromOfficerId: "22222222-2222-4222-8222-222222222222", toOfficerId: "33333333-3333-4333-8333-333333333333", action: "recall", remarks: null, movedAt: "2026-09-21T10:00:00.000Z" },
  ],
  dispatchHistory: [{ id: "d1", dispatchedTo: "Ministry of Finance", dispatchedBy: null, timestamp: "2026-09-22T10:00:00.000Z", remarks: "post" }],
  attachments: [{ id: "a1", fileName: "annexure.pdf", fileType: "application/pdf", size: 2048, uploadedAt: "2026-09-18T08:05:00.000Z" }],
  ...over,
});

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, body)));
}

beforeEach(() => {
  mockGet.mockReturnValue({ value: globalThis.crypto.randomUUID() });
  process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CIVITASONE_API_BASE_URL;
});

describe("getEstabFileById — the real file-detail payload passes the schema and reaches the page intact", () => {
  it("is not rejected for a closed, public file with unresolved (null) officer names", async () => {
    stubFetch(dto());
    const res = await getEstabFileById(FILE_ID);
    expect(res.source).toBe("api");
    expect(res.data?.id).toBe(FILE_ID);
    expect(res.data?.status).toBe("closed");
    expect(res.data?.classification).toBe("unclassified");
  });

  it("keeps each note's noteType, noteStatus, eSigned and signedAt (they used to be stripped)", async () => {
    stubFetch(dto());
    const notes = (await getEstabFileById(FILE_ID)).data?.noteSheets ?? [];
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ id: "n1", author: "", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null });
    expect(notes[1]).toMatchObject({ id: "n2", author: "Anita Desai", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-20T09:35:00.000Z", type: "order" });
  });

  it("keeps the typed movement trail, dakNo and dueBy", async () => {
    stubFetch(dto());
    const file = (await getEstabFileById(FILE_ID)).data;
    expect(file?.dakNo).toBe("DAK/2026/114");
    expect(file?.dueBy).toBe("2026-10-10T00:00:00.000Z");
    expect(file?.movementHistory).toEqual([
      { id: "m1", fromOfficerId: null, toOfficerId: "22222222-2222-4222-8222-222222222222", action: "forward", movedAt: "2026-09-19T10:00:00.000Z", status: null, remarks: "For comment" },
      { id: "m2", fromOfficerId: "22222222-2222-4222-8222-222222222222", toOfficerId: "33333333-3333-4333-8333-333333333333", action: "recall", movedAt: "2026-09-21T10:00:00.000Z", status: null, remarks: null },
    ]);
    expect(file?.dispatchHistory[0]).toMatchObject({ dispatchedTo: "Ministry of Finance", dispatchedBy: "—" });
    expect(file?.attachments).toHaveLength(1);
  });

  it("an open file with a draft note and no movement still loads (empty trail, not an error)", async () => {
    stubFetch(dto({ status: "draft", movementHistory: [], dispatchHistory: [], attachments: [], dakNo: null, dueBy: null, noteSheets: [] }));
    const res = await getEstabFileById(FILE_ID);
    expect(res.source).toBe("api");
    expect(res.data?.status).toBe("active"); // a draft file is still in work
    expect(res.data?.movementHistory).toEqual([]);
    expect(res.data?.dakNo).toBeUndefined();
  });

  it("still refuses a payload that is not a file (no id), as an invalid-payload error", async () => {
    stubFetch({ fileNo: "X", subject: "Y" });
    const res = await getEstabFileById(FILE_ID);
    expect(res.source).toBe("error");
    expect(res.data).toBeNull();
  });
});

describe("getEstabFiles — the register keeps a closed file closed", () => {
  it("maps closed to closed, archived to archived, and a draft or active file to active", async () => {
    stubFetch({ data: [
      { id: "a", fileNo: "F/A", subject: "S", status: "closed" },
      { id: "b", fileNo: "F/B", subject: "S", status: "archived" },
      { id: "c", fileNo: "F/C", subject: "S", status: "draft" },
      { id: "d", fileNo: "F/D", subject: "S", status: "active" },
    ] });
    const byNo = new Map((await getEstabFiles()).data.map((f) => [f.fileNo, f.status]));
    expect(Object.fromEntries(byNo)).toEqual({ "F/A": "closed", "F/B": "archived", "F/C": "active", "F/D": "active" });
  });
});

describe("getEstabDashboard — the pendency snapshot's own figures survive the schema and mapper", () => {
  it("carries openFiles and oldestPendencyDays", async () => {
    stubFetch({ filesPending: 3, meetingsToday: 1, vehiclesInUse: 2, complianceItemsDue: 4, slaBreached: 2, dakPending: 5, avgPendencyDays: 15, openFiles: 4, oldestPendencyDays: 30 });
    const res = await getEstabDashboard();
    expect(res.source).toBe("api");
    expect(res.data).toMatchObject({ openFiles: 4, oldestPendencyDays: 30, avgPendencyDays: 15, vehiclesInUse: 2 });
  });

  it("defaults both to 0 when an older service does not send them", async () => {
    stubFetch({ filesPending: 3, meetingsToday: 1, vehiclesInUse: 2, complianceItemsDue: 4, slaBreached: 2, dakPending: 5, avgPendencyDays: 15 });
    const res = await getEstabDashboard();
    expect(res.data).toMatchObject({ openFiles: 0, oldestPendencyDays: 0 });
  });
});
