/**
 * w0-report.md defect "a branding logo can never be saved": the web editor put
 * an uploaded file (data: URL) into `logoUrl`, which the API rejects
 * (z.string().url()). Uploaded logos now travel in `logoDataUrl` - PNG/JPEG/
 * WebP only, decoded size <= 200KB, validated server-side; SVG is rejected
 * (no sanitiser). DB-backed: proves the 150KB happy path persists through the
 * real command -> consumer -> brand_config path, with the audit event in the
 * same transaction, and that bad uploads get a clear 400.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTokenConsumers } from "../src/modules/tokens/consumer.js";
import { brandConfig } from "../src/modules/tokens/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function dataUrl(mime: string, head: Buffer, totalBytes: number): string {
  const body = Buffer.concat([head, Buffer.alloc(Math.max(0, totalBytes - head.length), 7)]);
  return `data:${mime};base64,${body.toString("base64")}`;
}
const png = (bytes: number) => dataUrl("image/png", PNG_SIG, bytes);

function hdr() {
  const t = signToken({ sub: ACTOR, tid: TENANT, roles: ["theme_admin"], sid: "sess-logo" }, SECRET, 3600);
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}
async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}
const readRow = () =>
  runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(brandConfig).where(eq(brandConfig.tenantId, TENANT))));

let app: FastifyInstance;

beforeAll(async () => {
  registerTokenConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(brandConfig).where(eq(brandConfig.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

async function put(payload: unknown) {
  return app.inject({ method: "PUT", url: "/v1/themes/brand", headers: hdr(), payload: payload as object });
}

describe("PUT /v1/themes/brand - logoDataUrl", () => {
  it("rejects SVG with a clear 400", async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>").toString("base64")}`;
    const res = await put({ logoDataUrl: svg });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors[0].field).toBe("logoDataUrl");
    expect(body.fieldErrors[0].message).toMatch(/PNG, JPEG or WebP.*SVG is not supported/);
  });

  it("rejects an oversize file (decoded > 200KB) with a clear 400", async () => {
    const res = await put({ logoDataUrl: png(201 * 1024) });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors[0].message).toMatch(/200KB or smaller/);
  });

  it("rejects a mislabelled file (PNG mime, non-PNG bytes) with a clear 400", async () => {
    const res = await put({ logoDataUrl: dataUrl("image/png", Buffer.from("<script>"), 2048) });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors[0].message).toMatch(/does not match/);
  });

  it("still rejects a data: URL placed in logoUrl (external URLs only)", async () => {
    const res = await put({ logoUrl: png(2048) });
    expect(res.statusCode).toBe(400);
  });

  it("202 saves a 150KB PNG, persists it, and audits the change in the same transaction", async () => {
    const logo = png(150 * 1024);
    const res = await put({ appName: "Logo Test Dept", logoDataUrl: logo });
    expect(res.statusCode).toBe(202);

    const row = await waitFor(async () => (await readRow())[0] ?? null);
    expect(row.logoDataUrl).toBe(logo);
    expect(row.logoUrl).toBeNull();

    const get = await app.inject({ method: "GET", url: "/v1/themes/brand", headers: hdr() });
    expect(get.json().logoDataUrl).toBe(logo);

    const events = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages)
      .where(eq(outboxMessages.tenantId, TENANT))));
    const audits = events.filter((r) => r.topic === "audit.event.record");
    expect(audits.some((r) => {
      const p = r.payload as { action?: string; resourceType?: string };
      return p.resourceType === "brand" && p.action === "upsert";
    })).toBe(true);
    const upserted = events.find((r) => (r.payload as { changedFields?: string[] }).changedFields);
    expect((upserted!.payload as { changedFields: string[] }).changedFields).toContain("logoDataUrl");
    // audit/event payloads carry field names only, never the logo bytes
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain("base64");
  });

  it("the DB CHECK constraint is a backstop: SVG written around the API is refused", async () => {
    await expect(
      runWithTenant(TENANT, () => db.transaction((tx) => tx.update(brandConfig)
        .set({ logoDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })
        .where(eq(brandConfig.tenantId, TENANT)))),
    ).rejects.toThrow();
  });

  it("accepts null to clear the uploaded logo", async () => {
    const res = await put({ logoDataUrl: null });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => ((await readRow())[0]?.logoDataUrl === null ? true : null));
  });
});
