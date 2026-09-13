/**
 * DOM-015 — POST /v1/projects/:id/site-photos must never hand back a
 * fabricated presigned URL.
 *
 * Before this fix, `requestPhotoUpload` always returned
 * `...?presigned=placeholder` as `uploadUrl` regardless of whether AWS
 * credentials were configured — a URL that looks real but a client's PUT to
 * it would just fail. This mirrors inspection-service's already-reviewed
 * evidence-upload pattern (tests/evidence-presign-storage.test.ts): an
 * explicit `not_configured` status with no uploadUrl at all when credentials
 * are absent, and a REAL SigV4 presigned PUT URL (offline HMAC signing — no
 * network call, so this runs fully offline) when they are present.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000ee";
const PROJECT_ID = "cccccccc-1111-4000-8000-000000000001";

function authHeader() {
  const jwt = signToken({ sub: "user-dom015", tid: TENANT, roles: ["project_manager"] }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
let sqlClient: { end: () => Promise<void> };

// Preserve/restore credential env between tests so both branches are exercised.
const ORIG = { key: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };

beforeAll(async () => {
  const appMod = await import("../src/app.js");
  const dbMod = await import("../src/shared/db.js");
  app = await appMod.buildApp();
  sqlClient = dbMod.sqlClient;
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
  if (ORIG.key) process.env.AWS_ACCESS_KEY_ID = ORIG.key; else delete process.env.AWS_ACCESS_KEY_ID;
  if (ORIG.secret) process.env.AWS_SECRET_ACCESS_KEY = ORIG.secret; else delete process.env.AWS_SECRET_ACCESS_KEY;
});

beforeEach(() => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
});

describe("POST /v1/projects/:id/site-photos — storage gating (DOM-015)", () => {
  it("returns an explicit not_configured status (no fake URL) when credentials are absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/site-photos`,
      headers: authHeader(),
      payload: { originalName: "site-photo.jpg", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("not_configured");
    expect(body.uploadUrl).toBeUndefined(); // never a fabricated success URL
    expect(body.s3Key).toContain(`projects/${PROJECT_ID}/`);
  });

  it("returns a REAL SigV4 presigned PUT URL (never the old placeholder) when storage is configured", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "secretkeyexample";
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/site-photos`,
      headers: authHeader(),
      payload: { originalName: "site-photo.jpg", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.uploadUrl).toContain("X-Amz-Signature=");
    expect(body.uploadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(body.uploadUrl).not.toContain("presigned=placeholder");
  });
});
