import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { getEstabFileById, getEstabDeskFiles } from "./loaders";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

// The exact shape estab-service GET /v1/estab/files/:id sends for a file that was JUST created
// (services/estab-service/src/modules/files/queries.ts getFileDetail): classification "public",
// status "draft", an unresolved holder as null, createdAt rather than createdDate/createdBy.
const FRESH_FILE_DTO = {
  id: "f1",
  fileNo: "ADMIN/00042/2026",
  subject: "Road repair request",
  dept: "ADMIN",
  department: "ADMIN",
  classification: "public",
  currentWith: "11111111-1111-4111-8111-111111111111",
  currentHolder: null,
  status: "draft",
  fileType: "general",
  volumeNo: 1,
  partNo: null,
  parentFileId: null,
  linkedFileIds: [],
  dakNo: null,
  inwardId: null,
  dueBy: null,
  createdAt: "2026-10-22T04:00:00.000Z",
  noteSheets: [],
  movementHistory: [],
  dispatchHistory: [],
  attachments: [],
};

describe("estab file loaders against the shapes estab-service really sends", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("GAP-ESTAB-FILES-NEW-06: getEstabFileById loads a freshly created file (public / draft / unresolved holder) so its number can be shown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, FRESH_FILE_DTO)));
    const res = await getEstabFileById("f1");
    expect(res.source).toBe("api");
    expect(res.data?.fileNo).toBe("ADMIN/00042/2026");
    expect(res.data?.subject).toBe("Road repair request");
    // The service's "public" tier reads as unclassified on the web model.
    expect(res.data?.classification).toBe("unclassified");
  });

  it("getEstabFileById still reports an error for a payload with no file number (nothing to show)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: "f1", subject: "No number" })));
    const res = await getEstabFileById("f1");
    expect(res.source).toBe("error");
    expect(res.data).toBeNull();
  });

  it("getEstabFileById reports an error (not a file) when the service answers 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message: "file not found" })));
    const res = await getEstabFileById("f1");
    expect(res.source).toBe("error");
    expect(res.data).toBeNull();
  });

  it("GAP-ESTAB-INBOX-01: getEstabDeskFiles maps the desk rows and the operator flags", async () => {
    const row = { ...FRESH_FILE_DTO, tenantId: "t", currentWith: "22222222-2222-4222-8222-222222222222" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [row],
      actorId: "u1",
      employeeId: "22222222-2222-4222-8222-222222222222",
      operator: { adopted: true, enrolled: false },
    })));
    const res = await getEstabDeskFiles();
    expect(res.source).toBe("api");
    expect(res.data.files.map((f) => f.fileNo)).toEqual(["ADMIN/00042/2026"]);
    expect(res.data.notEnrolled).toBe(true);
  });

  it.each([
    ["an enrolled operator", { adopted: true, enrolled: true }],
    ["a tenant that has not adopted operators", { adopted: false, enrolled: false }],
  ])("getEstabDeskFiles does not call %s 'not enrolled'", async (_n, operator) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: [], operator })));
    const res = await getEstabDeskFiles();
    expect(res.data.notEnrolled).toBe(false);
  });

  it("getEstabDeskFiles never claims 'not enrolled' when the flags are absent, and a failure is an error with an empty desk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })));
    expect((await getEstabDeskFiles()).data.notEnrolled).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, { code: "HRMS_UNAVAILABLE" })));
    const failed = await getEstabDeskFiles();
    expect(failed.source).toBe("error");
    expect(failed.data).toEqual({ files: [], notEnrolled: false });
  });
});
