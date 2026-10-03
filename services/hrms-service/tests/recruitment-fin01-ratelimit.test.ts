/**
 * Public resume upload rate limit (review fix): its own per-client bucket, real client IP behind internal proxies only,
 * loopback not exempt, a coarser per-tenant cap, and no spoofing from an untrusted peer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";
const OTHER_TENANT = "aaaaaaaa-0001-4000-8000-00000000a002";
const JOB = "22222222-0001-4000-8000-000000000002";

const H = vi.hoisted(() => ({ findPublishedOpening: vi.fn(), putObject: vi.fn(async () => undefined) }));
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findPublishedOpening: (...a: unknown[]) => H.findPublishedOpening(...a),
}));
vi.mock("@civitasone/storage", async (io) => ({ ...(await io<Record<string, unknown>>()), putObject: (...a: unknown[]) => (H.putObject as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@civitasone/scanner", () => ({ scanBuffer: async () => ({ status: "clean" }) }));

import { registerRateLimit } from "@civitasone/rate-limit";
import { careersResumeRoutes } from "../src/modules/recruitment/careers-resume-routes.js";
import { INTERNAL_PROXY_TRUST, createFixedWindowLimiter, resumeRateKey } from "../src/modules/recruitment/careers-resume.js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, 0x20)]).toString("base64");
const body = (tenantId = TENANT, jobOpeningId = JOB) => ({ tenantId, jobOpeningId, fileName: "cv.pdf", mimeType: "application/pdf", contentBase64: PDF });

async function build(tenantMax = 1000) {
  // same wiring as hrms-service buildApp: trustProxy + the global actorId-or-IP limiter (loopback allow-listed)
  const app = Fastify({ trustProxy: INTERNAL_PROXY_TRUST });
  await registerRateLimit(app, { max: 300, timeWindow: "1 minute", keyGenerator: (req) => (req as unknown as { ctx?: { actorId?: string } }).ctx?.actorId ?? req.ip ?? "anonymous" });
  await app.register(careersResumeRoutes, { tenantMax });
  return app;
}
type App = Awaited<ReturnType<typeof build>>;
const post = (app: App, remoteAddress: string, xff?: string, payload = body()) =>
  app.inject({ method: "POST", url: "/v1/careers/resume", remoteAddress, headers: xff ? { "x-forwarded-for": xff } : {}, payload });

beforeEach(() => {
  H.findPublishedOpening.mockResolvedValue({ id: JOB, tenantId: TENANT, status: "open", isPublished: true });
});

async function exhaust(app: App, remote: string, xff?: string) {
  for (let i = 0; i < 10; i++) expect((await post(app, remote, xff)).statusCode).toBe(201);
}

describe("resume upload rate limit", () => {
  it("two client IPs behind the same internal proxy get separate buckets; the same IP is limited", async () => {
    const app = await build();
    await exhaust(app, "10.0.0.5", "203.0.113.7");
    expect((await post(app, "10.0.0.5", "203.0.113.7")).statusCode).toBe(429);        // same client: limited
    expect((await post(app, "10.0.0.5", "203.0.113.8")).statusCode).toBe(201);        // another client: own bucket
    await app.close();
  });

  it("an X-Forwarded-For from an UNTRUSTED peer is ignored: rotating it does not dodge the limit", async () => {
    const app = await build();
    await exhaust(app, "8.8.8.8", "1.1.1.1");
    for (const forged of ["1.1.1.2", "9.9.9.9", "203.0.113.50"]) expect((await post(app, "8.8.8.8", forged)).statusCode).toBe(429);
    await app.close();
  });

  it("loopback is NOT exempt on this route", async () => {
    const app = await build();
    await exhaust(app, "127.0.0.1");
    expect((await post(app, "127.0.0.1")).statusCode).toBe(429);
    await app.close();
  });

  it("the bucket is per vacancy: the same client uploading to another vacancy has its own", async () => {
    const app = await build();
    await exhaust(app, "10.0.0.5", "203.0.113.7");
    const otherJob = "22222222-0001-4000-8000-0000000000bb";
    H.findPublishedOpening.mockResolvedValue({ id: otherJob, tenantId: TENANT, status: "open", isPublished: true });
    expect((await post(app, "10.0.0.5", "203.0.113.7", body(TENANT, otherJob))).statusCode).toBe(201);
    await app.close();
  });

  it("a coarse per-tenant cap stops many distinct clients, and does not touch another tenant", async () => {
    const app = await build(3);
    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) expect((await post(app, "10.0.0.5", ip)).statusCode).toBe(201);
    const capped = await post(app, "10.0.0.5", "203.0.113.4");
    expect(capped.statusCode).toBe(429);
    expect(capped.json().code).toBe("TOO_MANY_UPLOADS");
    H.findPublishedOpening.mockResolvedValue({ id: JOB, tenantId: OTHER_TENANT, status: "open", isPublished: true });
    expect((await post(app, "10.0.0.5", "203.0.113.4", body(OTHER_TENANT))).statusCode).toBe(201);
    await app.close();
  });
});

describe("helpers", () => {
  it("the key is tenant + vacancy + client", () => {
    expect(resumeRateKey("t", "j", "1.2.3.4")).toBe("t:j:1.2.3.4");
  });
  it("trust is limited to internal ranges, never blanket", () => {
    expect(INTERNAL_PROXY_TRUST).toBe("loopback,linklocal,uniquelocal");
  });
  it("the fixed-window limiter resets after the window", () => {
    let t = 0;
    const l = createFixedWindowLimiter(2, 1000, () => t);
    expect([l.hit("a"), l.hit("a"), l.hit("a")]).toEqual([true, true, false]);
    t = 1000;
    expect(l.hit("a")).toBe(true);
    expect(l.hit(randomUUID())).toBe(true);
  });
});
