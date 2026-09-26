/**
 * finance-service — advanceAdjust consumer schema regression test.
 *
 * BUG: PATCH /v1/finance/advances/:id/adjust was completely non-functional.
 * The route's adjustAdvanceBody validator (validators.ts) parses
 * adjustedMinor via the bigint-safe moneyMinorField
 * (zMoneyMinorBase.pipe(z.bigint()...)), so the queue payload's
 * adjustedMinor is ALWAYS a genuine JS bigint by the time commands.ts
 * publishes it. The consumer's OWN re-validation schema (consumer.ts,
 * sub(COMMANDS.advanceAdjust, ...)) used to be
 * `z.union([z.string(), z.number()])` -- missing the z.bigint() branch that
 * billCreate/paymentInitiate's equivalent schemas already carry just above
 * it in the same file -- so every advanceAdjust command dead-lettered with
 * SCHEMA_VIOLATION and the advance's adjustedMinor was never updated.
 *
 * This test exercises the REAL end-to-end path (HTTP route -> queue ->
 * consumer) instead of hand-constructing a queue payload, which is how this
 * slipped through: the existing advances-uc.test.ts consumer-integration
 * coverage publishes directly to a throwaway `new MemoryQueue()` with a
 * plain-number payload, bypassing adjustAdvanceBody entirely, so it never
 * exercises the bigint the real route produces. Here we build the app AND
 * register the payments consumer on the SAME shared queue singleton
 * (`shared/infra.js`) that `commands.ts` publishes through -- the "combined
 * harness" needed because app.ts (HTTP) and worker.ts (consumers) normally
 * run as separate processes, each with its own independent QUEUE_DRIVER=memory
 * queue instance, so an HTTP-only test can never observe consumer-side
 * failures and a consumer-only test (fresh MemoryQueue + hand-built payload)
 * can never observe what the route actually sends.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeAdvances } from "../src/modules/payments/schema.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000088";
// resolveServiceContext derives actorId from the JWT `sub` claim, and
// actorId ends up written into uuid columns (created_by/updated_by) --
// it must be a real UUID, not a human-readable label.
const ACTOR_SUB = "00000000-aaaa-4000-8000-000000000088";

function makeToken(roles: string[] = ["finance_officer"], tid = TENANT) {
  return signToken({ sub: ACTOR_SUB, tid, roles, sid: "sess-088" }, SECRET);
}

async function waitFor(fn: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function readAdvance(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeAdvances).where(eq(financeAdvances.id, id)));
  return rows[0];
}

afterAll(async () => { await sqlClient.end(); });

describe("PATCH /v1/finance/advances/:id/adjust — consumer schema (combined HTTP+worker harness)", () => {
  it("adjusts the advance end-to-end: the route's real bigint payload is accepted by the consumer and adjustedMinor updates in the DB", { timeout: 15000 }, async () => {
    // Combined harness: HTTP app + payments consumer registered on the SAME
    // queue singleton, in one process -- mirrors worker.ts's registration
    // but in-thread, so a publish() triggered by the HTTP route is actually
    // delivered to a subscriber within this test.
    registerPaymentsConsumers(queue);
    await queue.start();

    const app = await buildApp();
    const token = makeToken();

    // 1) Create an advance via the real route. (advanceCreate's consumer has
    //    NO re-validation schema at all -- see consumer.ts -- so it was
    //    never exposed to this bug; only used here to get a real row.)
    const createRes = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        advanceNo: `ADV-SCHEMA-FIX-${randomUUID().slice(0, 8)}`,
        purpose: "Field survey advance", amountMinor: "1000000", currency: "INR",
      },
    });
    expect(createRes.statusCode).toBe(202);
    const advanceId = createRes.json().id as string;

    const created = await waitFor(async () => (await readAdvance(advanceId)) !== undefined);
    expect(created).toBe(true);

    const dlqBefore = (queue as unknown as MemoryQueue).dlq.length;

    // 2) Adjust it via the real route. adjustAdvanceBody.parse() decodes
    //    "300000" into a genuine bigint (moneyMinorField) exactly like
    //    production -- this is the payload shape that used to dead-letter.
    const adjustRes = await app.inject({
      method: "PATCH", url: `/v1/finance/advances/${advanceId}/adjust`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { adjustedMinor: "300000", reason: "Partial utilisation verified on site visit" },
    });
    expect(adjustRes.statusCode).toBe(202);

    const adjusted = await waitFor(async () => (await readAdvance(advanceId))?.adjustedMinor === 300000n);

    await app.close();
    await queue.stop();

    // The regression: pre-fix, this message dead-letters with
    // `SCHEMA_VIOLATION: ... expected string, received bigint` (or similar)
    // and adjustedMinor never moves off 0. Assert the DLQ stayed clean AND
    // the row actually updated -- either one alone could pass for the wrong
    // reason (e.g. a silently-swallowed error).
    const newDlqEntries = (queue as unknown as MemoryQueue).dlq.slice(dlqBefore);
    const schemaViolation = newDlqEntries.find(
      (e) => e.topic === "finance.advance.adjust" && /SCHEMA_VIOLATION/.test(e.error),
    );
    expect(
      schemaViolation,
      `advanceAdjust dead-lettered: ${schemaViolation ? schemaViolation.error : "(none)"}`,
    ).toBeUndefined();

    expect(adjusted).toBe(true);
    const row = await readAdvance(advanceId);
    expect(row?.adjustedMinor).toBe(300000n);
    // 300000 < amountMinor (1000000) -- balance remains positive, so the
    // advance stays "active" rather than flipping to "adjusted".
    expect(row?.status).toBe("active");
  });

  it("flips status to 'adjusted' once adjustedMinor reaches amountMinor", { timeout: 15000 }, async () => {
    registerPaymentsConsumers(queue);
    await queue.start();

    const app = await buildApp();
    const token = makeToken();

    const createRes = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        advanceNo: `ADV-SCHEMA-FIX-FULL-${randomUUID().slice(0, 8)}`,
        purpose: "Full and final adjustment", amountMinor: "50000", currency: "INR",
      },
    });
    expect(createRes.statusCode).toBe(202);
    const advanceId = createRes.json().id as string;
    expect(await waitFor(async () => (await readAdvance(advanceId)) !== undefined)).toBe(true);

    const adjustRes = await app.inject({
      method: "PATCH", url: `/v1/finance/advances/${advanceId}/adjust`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { adjustedMinor: "50000", reason: "Full utilisation, closing the advance" },
    });
    expect(adjustRes.statusCode).toBe(202);

    const adjusted = await waitFor(async () => (await readAdvance(advanceId))?.status === "adjusted");

    await app.close();
    await queue.stop();

    expect(adjusted).toBe(true);
    const row = await readAdvance(advanceId);
    expect(row?.adjustedMinor).toBe(50000n);
    expect(row?.status).toBe("adjusted");
  });
});
