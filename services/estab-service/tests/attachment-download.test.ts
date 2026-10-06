/**
 * GAP-ESTAB-FILES-DETAIL-02: attachment download access gate.
 *
 * The download endpoint must authenticate, 404 unknown files/attachments, and
 * never leak a storage key without the per-file classification access check.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["estab_officer"], sub = "user-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/estab/files/:id/attachments/:attId/download (DETAIL-02)", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${randomUUID()}/attachments/${randomUUID()}/download`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown file", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${randomUUID()}/attachments/${randomUUID()}/download`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 on a non-UUID attachment id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${randomUUID()}/attachments/not-a-uuid/download`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
