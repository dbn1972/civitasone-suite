/**
 * B27 (policy reject_reason visibility) + D6 (document archive) — DB-free unit tests.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const archiveAudited = vi.hoisted(() => vi.fn());
vi.mock("../src/modules/documents/repo.js", async (orig) => ({
  ...(await orig<typeof import("../src/modules/documents/repo.js")>()),
  archiveAudited,
  getById: vi.fn().mockResolvedValue({ id: "x" }),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { toView, canSeeRejectReason } from "../src/modules/policies/repo.js";
import type { PolicyRow } from "../src/modules/policies/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000b27";
const DOC = "cccccccc-0000-4000-8000-0000000000d6";
const tok = (roles: string[]) => signToken({ sub: "aaaaaaaa-0000-4000-8000-00000000a0d6", tid: TENANT, roles, sid: "s" }, SECRET, 3600);

const AUTHOR = "aaaaaaaa-0000-4000-8000-00000000a001";
const row = {
  id: "p1", tenantId: TENANT, docType: "sop", referenceNo: "HR-SOP-014", title: "Leave Encashment SOP",
  body: "b", status: "draft", authorId: AUTHOR, reviewerId: null, approverId: null,
  effectiveDate: null, reviewDueDate: null, supersedesId: null, version: 1, publishedAt: null,
  rejectReason: "Clause 4.2 conflicts with the 2026 leave rules.",
  createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-02T00:00:00Z"),
  createdBy: AUTHOR, updatedBy: AUTHOR,
} as unknown as PolicyRow;

describe("B27 policy rejectReason visibility", () => {
  it("shows to the author and to approver-role viewers", () => {
    expect(toView(row, { actorId: AUTHOR, privileged: false }).rejectReason).toMatch(/Clause 4.2/);
    expect(toView(row, { actorId: "other", privileged: true }).rejectReason).toMatch(/Clause 4.2/);
  });
  it("hides from ordinary staff and from viewer-less internal callers", () => {
    expect(toView(row, { actorId: "other", privileged: false }).rejectReason).toBeNull();
    expect(toView(row).rejectReason).toBeNull();
    expect(canSeeRejectReason(row)).toBe(false);
  });
});

describe("D6 PATCH /v1/knowledge/articles/:id/archive", () => {
  const url = `/v1/knowledge/articles/${DOC}/archive`;
  const hdr = (roles: string[]) => ({ authorization: `Bearer ${tok(roles)}`, "content-type": "application/json" });
  afterAll(async () => { await sqlClient.end(); });

  it("403 for knowledge_user, 400 without a reason, 409 when already archived, 200 on success", async () => {
    const app = await buildApp();
    try {
      let r = await app.inject({ method: "PATCH", url, headers: hdr(["knowledge_user"]), payload: { reason: "Superseded by the 2026 circular." } });
      expect(r.statusCode).toBe(403);
      r = await app.inject({ method: "PATCH", url, headers: hdr(["knowledge_admin"]), payload: {} });
      expect(r.statusCode).toBe(400);
      expect(archiveAudited).not.toHaveBeenCalled();
      archiveAudited.mockResolvedValueOnce("already_archived");
      r = await app.inject({ method: "PATCH", url, headers: hdr(["knowledge_admin"]), payload: { reason: "Superseded by the 2026 circular." } });
      expect(r.statusCode).toBe(409);
      archiveAudited.mockResolvedValueOnce("ok");
      r = await app.inject({ method: "PATCH", url, headers: hdr(["knowledge_admin"]), payload: { reason: "Superseded by the 2026 circular." } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("archived");
      expect(archiveAudited).toHaveBeenLastCalledWith(TENANT, DOC, expect.anything(), "Superseded by the 2026 circular.");
    } finally { await app.close(); }
  });
});
