/**
 * POST /v1/crm/deals create-path guards (no database needed: a pipeline-less
 * create only touches the in-memory queue/cache).
 *
 * GAP-CRM-DEALS-NEW-01  a deal can only be CREATED open. Won/Lost are reached
 *                       through POST /:id/close (reason + audit), so the create
 *                       route rejects them with 422 USE_CLOSE_ENDPOINT.
 *                       Spelling variants (won, WON, Closed Won, closed_lost ...) are
 *                       the same terminal stage: the web maps them all to Concluded/
 *                       Lapsed, so they are rejected on create AND on PATCH /:id/stage.
 * GAP-CRM-DEALS-NEW-03  valueMinor is an exact paise digit string on the wire
 *                       (the web form posts "123456789"); a legacy safe-integer
 *                       number is still accepted, junk is a 400 (never a 500).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { createDealBody } from "../src/modules/deals/validators.js";
import { isTerminalStage } from "../src/modules/deals/stage-gate.js";

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

  // Reviewer finding: the guard was an exact-case match, so these spellings returned 202
  // and the list then showed the deal as Concluded/Lapsed with no reason or close audit.
  it.each(["won", "WON", "lost", "LOST", "closed_won", "Closed Won", "closed_lost", "Closed Lost", " Won ", "closed  lost"])(
    "rejects the stage spelling %j with 422 USE_CLOSE_ENDPOINT and enqueues nothing",
    async (stage) => {
      const publish = vi.spyOn(queue, "publish");
      const res = await create({ name: "Born closed", stage, valueMinor: 100000 });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("USE_CLOSE_ENDPOINT");
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("rejects a re-cased closed stage on a pipeline-scoped create before any pipeline lookup", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await create({ name: "Born closed", pipelineId: PIPELINE, stage: "Closed Won" });
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

describe("terminal stage detection (shared by create and PATCH /:id/stage)", () => {
  it.each(["Won", "Lost", "won", "WON", "lost", "closed_won", "Closed Won", "CLOSED_LOST", "closed lost", "  lost  "])(
    "treats %j as terminal",
    (stage) => {
      expect(isTerminalStage(stage)).toBe(true);
    },
  );

  it.each(["Lead", "Proposal", "Negotiation", "Qualification", "Wonderful", "Lost Cause", "Closed", "Won Back Later"])(
    "does not treat the open or look-alike stage %j as terminal",
    (stage) => {
      expect(isTerminalStage(stage)).toBe(false);
    },
  );
});

describe("GAP-CRM-DEALS-NEW-01 — PATCH /:id/stage rejects every spelling of a closed stage", () => {
  const DEAL = "eeeeeeee-2222-4000-8000-0000000000c4";

  it.each(["Won", "won", "WON", "Lost", "lost", "closed_won", "Closed Won", "closed_lost", "Closed Lost"])(
    "rejects a move into %j with 422 USE_CLOSE_ENDPOINT and enqueues nothing",
    async (stage) => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/crm/deals/${DEAL}/stage`,
        headers: headers(),
        payload: { stage, version: 1 },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("USE_CLOSE_ENDPOINT");
      expect(publish).not.toHaveBeenCalled();
    },
  );
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

  // Reviewer finding: a JSON number past 2^53 made the codec's transform return z.NEVER and
  // the int8 refine then ran BigInt(z.NEVER) -> SyntaxError -> 500 INTERNAL (retryable).
  // These must be a clean 400, with nothing enqueued.
  it.each([[1e20], [9007199254740993], [2 ** 60], [1e300]])(
    "rejects the unsafe JSON number %j with a 400 (never a 500) and enqueues nothing",
    async (valueMinor) => {
      const publish = vi.spyOn(queue, "publish");
      const res = await create({ name: "Too big", stage: "Lead", valueMinor });
      expect(res.statusCode).toBe(400);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("parses an unsafe number as a ZodError, not a thrown SyntaxError", () => {
    const parsed = createDealBody.safeParse({ name: "x", valueMinor: 1e20 });
    expect(parsed.success).toBe(false);
  });

  it("still accepts the largest storable amount exactly (int8 max) and rejects one more", () => {
    expect(createDealBody.parse({ name: "x", valueMinor: "9223372036854775807" }).valueMinor).toBe("9223372036854775807");
    expect(createDealBody.safeParse({ name: "x", valueMinor: "9223372036854775808" }).success).toBe(false);
  });

  it("defaults an omitted valueMinor to the string '0'", () => {
    expect(createDealBody.parse({ name: "x" }).valueMinor).toBe("0");
  });
});
