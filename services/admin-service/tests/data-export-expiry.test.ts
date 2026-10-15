/**
 * GAP-TENANT-ADMIN-DATA-EXPORT-06 (real DB, real Fastify): the 48-hour expiry is
 * enforced on the server. The consumer stamps expires_at = now + 48h; the download
 * route answers 410 EXPIRED after that; and the LIST reports an expired export as
 * "expired" with no download URL (nothing else ever flips the stored status), so
 * the page never offers a link that 410s. Another tenant's export is a 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { exportRequests } from "../src/modules/data-export/schema.js";
import { effectiveExportStatus } from "../src/modules/data-export/routes.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const LIVE = randomUUID();
const STALE = randomUUID();
const OTHER = randomUUID();
const bearer = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles: ["tenant_admin"], tid } as never, SECRET)}` });

const base = (id: string, tenantId: string, expiresAt: Date) => ({
  id, tenantId, requestedBy: ACTOR, type: "full" as const, format: "csv" as const, status: "ready" as const,
  downloadUrl: `/v1/admin/data-export/${id}/download`, fileSizeBytes: 0, expiresAt, createdBy: ACTOR, updatedBy: ACTOR,
});

async function cleanup() {
  for (const t of [A, B]) await runWithTenant(t, () => db.transaction((tx) => tx.delete(exportRequests).where(eq(exportRequests.tenantId, t))));
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await runWithTenant(A, () => db.transaction(async (tx) => {
    await tx.insert(exportRequests).values(base(LIVE, A, new Date(Date.now() + 3600_000)));
    await tx.insert(exportRequests).values(base(STALE, A, new Date(Date.now() - 3600_000)));
  }));
  await runWithTenant(B, () => db.transaction((tx) => tx.insert(exportRequests).values(base(OTHER, B, new Date(Date.now() + 3600_000)))));
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("data export 48h expiry", () => {
  it("the list reports an expired export as expired with no download URL, a live one stays ready", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: bearer(A) });
    expect(r.statusCode).toBe(200);
    const data = (r.json() as { data: Array<{ id: string; status: string; downloadUrl: string | null }> }).data;
    const stale = data.find((d) => d.id === STALE)!;
    const live = data.find((d) => d.id === LIVE)!;
    expect(stale.status).toBe("expired");
    expect(stale.downloadUrl).toBeNull();
    expect(live.status).toBe("ready");
    expect(live.downloadUrl).toContain(LIVE);
    expect(data.find((d) => d.id === OTHER)).toBeUndefined();
  });

  it("download: live is 200, expired is 410 EXPIRED, another tenant's is 404", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/admin/data-export/${LIVE}/download`, headers: bearer(A) })).statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: `/v1/admin/data-export/${STALE}/download`, headers: bearer(A) });
    expect(gone.statusCode).toBe(410);
    expect((gone.json() as { code: string }).code).toBe("EXPIRED");
    expect((await app.inject({ method: "GET", url: `/v1/admin/data-export/${OTHER}/download`, headers: bearer(A) })).statusCode).toBe(404);
  });

  it("effectiveExportStatus leaves non-ready and non-expiring rows alone", () => {
    const past = new Date(Date.now() - 1000);
    expect(effectiveExportStatus({ status: "failed", expiresAt: past, downloadUrl: null }).status).toBe("failed");
    expect(effectiveExportStatus({ status: "ready", expiresAt: null, downloadUrl: "x" }).status).toBe("ready");
  });
});
