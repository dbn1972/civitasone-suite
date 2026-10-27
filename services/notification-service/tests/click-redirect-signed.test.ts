/**
 * CodeQL js/server-side-unvalidated-url-redirection (alert 936): /t/click must only redirect to links this
 * service signed into an outgoing email.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

vi.mock("../src/shared/infra.js", () => ({ queue: { publish: vi.fn().mockResolvedValue(undefined) }, cache: {} }));
vi.mock("../src/modules/analytics/repo.js", () => ({ getAggregateMetrics: vi.fn() }));

const { analyticsRoutes } = await import("../src/modules/analytics/routes.js");
const { instrumentHtml, signTrackedLink, verifyTrackedLink } = await import("../src/modules/analytics/domain.js");
const { queue } = await import("../src/shared/infra.js");

const SECRET = `trk-${globalThis.crypto.randomUUID()}`;
const DELIVERY = randomUUID();
let app: FastifyInstance;

beforeAll(async () => {
  process.env.NOTIFICATION_TRACKING_SECRET = SECRET;
  app = Fastify();
  await app.register(analyticsRoutes);
  await app.ready();
});
afterAll(async () => {
  delete process.env.NOTIFICATION_TRACKING_SECRET;
  await app.close();
});

describe("GET /t/click/:deliveryId", () => {
  it("refuses an unsigned arbitrary redirect target (open redirect)", async () => {
    const res = await app.inject({ method: "GET", url: `/t/click/${DELIVERY}?url=${encodeURIComponent("https://evil.example/phish")}` });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it("refuses a signature minted for a different destination or delivery", async () => {
    const sig = signTrackedLink(SECRET, DELIVERY, "https://good.example/a");
    const swapped = await app.inject({ method: "GET", url: `/t/click/${DELIVERY}?url=${encodeURIComponent("https://evil.example/")}&sig=${sig}` });
    expect(swapped.statusCode).toBe(400);
    const other = await app.inject({ method: "GET", url: `/t/click/${randomUUID()}?url=${encodeURIComponent("https://good.example/a")}&sig=${sig}` });
    expect(other.statusCode).toBe(400);
  });

  it("fails closed when no signing secret is configured", async () => {
    delete process.env.NOTIFICATION_TRACKING_SECRET;
    const sig = signTrackedLink("", DELIVERY, "https://good.example/a");
    const res = await app.inject({ method: "GET", url: `/t/click/${DELIVERY}?url=${encodeURIComponent("https://good.example/a")}&sig=${sig}` });
    process.env.NOTIFICATION_TRACKING_SECRET = SECRET;
    expect(res.statusCode).toBe(400);
  });

  it("redirects 302 and records the click for a link produced by instrumentHtml", async () => {
    const html = instrumentHtml('<a href="https://good.example/a?x=1">go</a>', DELIVERY, "", false, SECRET);
    const link = /href="([^"]+)"/.exec(html)![1]!;
    const res = await app.inject({ method: "GET", url: link });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://good.example/a?x=1");
    expect(queue.publish).toHaveBeenCalledTimes(1);
  });
});

describe("verifyTrackedLink", () => {
  it("rejects malformed signatures", () => {
    expect(verifyTrackedLink(SECRET, DELIVERY, "https://a", undefined)).toBe(false);
    expect(verifyTrackedLink(SECRET, DELIVERY, "https://a", "zz")).toBe(false);
  });
});
