import { describe, it, expect } from "vitest";
import { mapEstabFileDetail, mapEstabFileSummaries } from "./apiMappers";

/**
 * GAP-ESTAB-FILES-DETAIL-06 — mapEstabFileDetail has a unit test of its own (it was only ever
 * exercised through a page test that mocks the loader wholesale), including a payload with a
 * movement trail; and GAP-ESTAB-FILES-DETAIL-01 — the register keeps `closed` distinct.
 */
const base = {
  id: "f1", fileNo: "ESTAB-A/00001/2026", subject: "Subject", classification: "secret", status: "active",
  dept: "ADMIN", createdAt: "2026-09-01T05:00:00.000Z", currentHolder: "Meera Iyer",
};

describe("mapEstabFileDetail", () => {
  it("maps a payload with a movement trail, typed, in order", () => {
    const file = mapEstabFileDetail({
      ...base,
      movementHistory: [
        { id: "m1", fromOfficerId: null, toOfficerId: "u2", action: "forward", remarks: "For comment", movedAt: "2026-09-02T10:00:00.000Z" },
        { id: "m2", fromOfficerId: "u2", toOfficerId: "u3", action: "recall", movedAt: "2026-09-03T10:00:00.000Z", status: "done" },
        { id: "bad-no-target" },
        "not-a-row",
      ],
    });
    expect(file?.movementHistory).toEqual([
      { id: "m1", fromOfficerId: null, toOfficerId: "u2", action: "forward", movedAt: "2026-09-02T10:00:00.000Z", status: null, remarks: "For comment" },
      { id: "m2", fromOfficerId: "u2", toOfficerId: "u3", action: "recall", movedAt: "2026-09-03T10:00:00.000Z", status: "done", remarks: null },
    ]);
  });

  it("carries noteType, noteStatus, eSigned and signedAt on each note, and an empty author for an unresolved officer", () => {
    const file = mapEstabFileDetail({
      ...base,
      noteSheets: [
        { id: "n1", author: null, content: "c1", timestamp: "2026-09-02T10:00:00.000Z", type: "note", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null },
        { id: "n2", author: "Anita Desai", content: "c2", timestamp: "2026-09-03T10:00:00.000Z", type: "order", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-03T10:05:00.000Z" },
      ],
    });
    expect(file?.noteSheets).toEqual([
      { id: "n1", author: "", content: "c1", timestamp: "2026-09-02T10:00:00.000Z", type: "note", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null },
      { id: "n2", author: "Anita Desai", content: "c2", timestamp: "2026-09-03T10:00:00.000Z", type: "order", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-03T10:05:00.000Z" },
    ]);
  });

  it("exposes dakNo and dueBy, and leaves them undefined when absent", () => {
    expect(mapEstabFileDetail({ ...base, dakNo: "DAK/2026/9", dueBy: "2026-10-01T00:00:00.000Z" })).toMatchObject({ dakNo: "DAK/2026/9", dueBy: "2026-10-01T00:00:00.000Z" });
    const bare = mapEstabFileDetail(base);
    expect(bare?.dakNo).toBeUndefined();
    expect(bare?.dueBy).toBeUndefined();
    expect(bare?.movementHistory).toEqual([]);
  });

  it("returns null for a payload that is not a file", () => {
    expect(mapEstabFileDetail(null)).toBeNull();
    expect(mapEstabFileDetail({ ...base, id: "" })).toBeNull();
    expect(mapEstabFileDetail({ ...base, subject: undefined })).toBeNull();
  });
});

describe("mapEstabFileSummaries — register status", () => {
  const statusOf = (status: string) => mapEstabFileSummaries([{ ...base, status }])?.[0]?.status;

  it("keeps closed, archived, disposed and pending as they are", () => {
    expect(statusOf("closed")).toBe("closed");
    expect(statusOf("archived")).toBe("archived");
    expect(statusOf("disposed")).toBe("disposed");
    expect(statusOf("pending")).toBe("pending");
  });

  it("presents draft and active (and anything unknown) as active — a file in work", () => {
    expect(statusOf("draft")).toBe("active");
    expect(statusOf("active")).toBe("active");
    expect(statusOf("something-new")).toBe("active");
  });

  it("is case-insensitive", () => {
    expect(statusOf("CLOSED")).toBe("closed");
  });
});
