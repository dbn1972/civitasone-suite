/**
 * GAP-TENANT-ADMIN-WEBHOOKS-05 (route level): the server, not the web form, is the
 * SSRF authority for POST /v1/admin/webhooks. A target in a private / loopback /
 * link-local range is rejected before anything is stored, zero events is rejected,
 * and a public https target is accepted. (The PUT path and the DNS-rebinding
 * re-resolution are pinned in webhook-ssrf.test.ts.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const hdr = () => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), roles: ["tenant_admin"], tid: randomUUID() } as never, SECRET)}` });

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const create = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/admin/webhooks", headers: hdr(), payload });

describe("POST /v1/admin/webhooks target validation", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1/hook",
    "http://localhost:8080/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.10/hook",
    "file:///etc/passwd",
  ])("rejects %s", async (url) => {
    const r = await create({ url, events: ["invoice.paid"] });
    expect(r.statusCode).toBe(400);
  });

  it("rejects an empty event list", async () => {
    expect((await create({ url: "https://example.com/hook", events: [] })).statusCode).toBe(400);
  });

  it("accepts a public https target (IP literal, so no DNS in CI) with at least one event", async () => {
    expect((await create({ url: "https://8.8.8.8/hook", events: ["invoice.paid"] })).statusCode).toBe(202);
  });
});
