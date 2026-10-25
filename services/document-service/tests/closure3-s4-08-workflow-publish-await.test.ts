/**
 * CLOS3-S4-08: workflow commands must await queue.publish. A publish failure has to surface to
 * the caller (retryable 5xx), never a 202 for a command that was not enqueued, and never an
 * unhandled rejection. DB-free: queue.publish is stubbed, buildApp does no DB read on this route.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import * as commands from "../src/modules/workflow/commands.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const tid = randomUUID();
const actor = randomUUID();
const ctx = { tenantId: tid, actorId: actor, correlationId: randomUUID() } as unknown as RequestContext;

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp();
  process.on("unhandledRejection", onUnhandled);
});
afterAll(async () => {
  process.off("unhandledRejection", onUnhandled);
  await app.close();
});
afterEach(() => { vi.restoreAllMocks(); unhandled.length = 0; });

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("CLOS3-S4-08 workflow commands await publish", () => {
  const calls: Array<[string, () => unknown]> = [
    ["createDak", () => commands.createDak(ctx, { subject: "s", body: "b" } as never)],
    ["forwardDak", () => commands.forwardDak(ctx, randomUUID(), randomUUID())],
    ["acknowledgeDak", () => commands.acknowledgeDak(ctx, randomUUID())],
    ["createNoting", () => commands.createNoting(ctx, randomUUID(), "n")],
    ["submitApproval", () => commands.submitApproval(ctx, randomUUID())],
    ["decideApproval", () => commands.decideApproval(ctx, randomUUID(), "approved")],
  ];

  for (const [name, call] of calls) {
    it(`${name} rejects when queue.publish rejects`, async () => {
      vi.spyOn(queue, "publish").mockRejectedValue(new Error("redis down"));
      await expect(Promise.resolve().then(call)).rejects.toThrow("redis down");
      await tick();
      expect(unhandled).toEqual([]);
    });
  }

  it("POST /v1/documents/daks returns 5xx (not 202) and no unhandled rejection when publish fails", async () => {
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("redis down"));
    const jwt = signToken({ sub: actor, tid, roles: ["document_user"], sid: "s" }, SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/v1/documents/daks",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": tid },
      payload: { subject: "Subject", body: "Body" },
    });
    await tick();
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(unhandled).toEqual([]);
  });

  it("publish success still returns 202 with an id", async () => {
    const pub = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const jwt = signToken({ sub: actor, tid, roles: ["document_user"], sid: "s" }, SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/v1/documents/daks",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": tid },
      payload: { subject: "Subject", body: "Body" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeTruthy();
    expect(pub).toHaveBeenCalledTimes(1);
  });
});
