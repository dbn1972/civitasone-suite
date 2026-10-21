/**
 * POST /v1/crm/deals create-path guards (no database needed: a pipeline-less
 * create only touches the in-memory queue/cache).
 *
 * GAP-CRM-DEALS-NEW-01  a deal can only be CREATED open. Won/Lost are reached
 *                       through POST /:id/close (reason + audit), so the create
 *                       route rejects them with 422 USE_CLOSE_ENDPOINT.
 * GAP-CRM-DEALS-NEW-03  valueMinor is an exact paise digit string on the wire
 *                       (the web form posts "123456789"); a legacy safe-integer
 *                       number is still accepted, junk is a 400.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { createDealBody } from "../src/modules/deals/validators.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-2222-4000-8000-0000000000c4";
const ACTOR = "cccccccc-2222-4000-8000-0000000000c4";
const PIPELINE = "bbbbbbbb-2222-4000-8000-0000000000c4";

function headers(roles: string[] = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-c4" }, SECRET)}`, "x-tenant-id": TENANT };
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function create(payload: Record<string, unknown>, roles?: string[]) {
  return app.inject({ method: "POST", url: "/v1/crm/deals", headers: headers(roles), payload });
}

describe("GAP-CRM-DEALS-NEW-01 — create rejects a closed stage", () => {
  it.each(["Won", "Lost"])("rejects stage %s with 422 USE_CLOSE_ENDPOINT and enqueues nothing", async (stage) => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create({ name: "Born closed", stage, valueMinor: 100000 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("USE_CLOSE_ENDPOINT");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a closed stage on a pipeline-scoped create before any pipeline lookup", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create({ name: "Born closed", pipelineId: PIPELINE, stage: "Won" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("USE_CLOSE_ENDPOINT");
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(["Lead", "Proposal", "Negotiation"])("still accepts the open stage %s (202)", async (stage) => {
    const res = await create({ name: "Open deal", stage, valueMinor: 100000 });
    expect(res.statusCode).toBe(202);
  });

  it("still accepts a create with no stage (defaults to Lead)", async () => {
    const res = await create({ name: "No stage" });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP-CRM-DEALS-NEW-03 — valueMinor wire type", () => {
  it("accepts the digit STRING the web form posts and enqueues it as the same exact string", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create({ name: "Precise", stage: "Lead", valueMinor: "123456789" });
    expect(res.statusCode).toBe(202);
    const payload = publish.mock.calls[0]![1].payload as { valueMinor: string };
    expect(payload.valueMinor).toBe("123456789");
  });

  it("keeps a precision-safe value above 2^53 intact when sent as a string", async () => {
    const publish = vi.spyOn(queue, "publish");
    const big = "9007199254740993"; // 2^53 + 1: a JS number would silently round this
    const res = await create({ name: "Huge", stage: "Lead", valueMinor: big });
    expect(res.statusCode).toBe(202);
    expect((publish.mock.calls[0]![1].payload as { valueMinor: string }).valueMinor).toBe(big);
  });

  it("still accepts a legacy JSON number", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create({ name: "Legacy", stage: "Lead", valueMinor: 250000 });
    expect(res.statusCode).toBe(202);
    expect((publish.mock.calls[0]![1].payload as { valueMinor: string }).valueMinor).toBe("250000");
  });

  it.each([["abc"], ["12.5"], ["-5"], [""], ["9223372036854775808"], [-1], [1.5]])(
    "rejects valueMinor %j with a 400",
    async (valueMinor) => {
      const res = await create({ name: "Bad value", stage: "Lead", valueMinor });
      expect(res.statusCode).toBe(400);
    },
  );

  it("defaults an omitted valueMinor to the string '0'", () => {
    expect(createDealBody.parse({ name: "x" }).valueMinor).toBe("0");
  });
});
