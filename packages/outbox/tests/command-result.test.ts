/**
 * FF-01 slice A (C1) — command-result LIBRARY tests.
 *
 * Design: erp-gap-remediation/03-designs/FF-01.md §2.1, §2.4 (guarded upsert
 * probe), §2.5 (state machine), §5 (security), owner decision D-20.
 *
 * Two layers:
 *  - pure/unit: CommandRefusal, refusalCodeOf, isEventShapedTopic,
 *    subscribeCommand's event-topic refusal + onOutcome composition, the D-20
 *    retention policy, and that getCommandResult never surfaces `reason`.
 *  - live Postgres (always runs; see COMMAND_RESULT_PG_URL below — never skipped): the §2.4 guarded upsert against a real driver —
 *    rejected→succeeded flips, a late rejected cannot downgrade a succeeded,
 *    attempts increments, and getCommandResult returns code+params but NOT
 *    reason.
 *
 * The live schema this file needs (created in beforeAll against a throwaway
 * container) is the evolved `_inbox.command_results` shape from index.ts /
 * 03-designs/FF-01.md §2.3 — every added column nullable or defaulted.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { NonRetryableError } from "@civitasone/queue";
import type { CommandOutcome } from "@civitasone/queue";
import {
  CommandRefusal,
  isCommandRefusal,
  refusalCodeOf,
  isEventShapedTopic,
  subscribeCommand,
  recordCommandResult,
  getCommandResult,
  outcomeToResultInput,
  makeRecordOutcome,
  COMMAND_RESULT_RETENTION,
  recordCommandOutcome,
  getCommandOutcome,
  DEFAULT_REFUSAL_CODE,
  type DrizzleTx,
} from "../src/index.js";

describe("CommandRefusal", () => {
  it("is a NonRetryableError carrying a stable code and non-PII params", () => {
    const err = new CommandRefusal("OVER_APPROPRIATION", {
      headId: "11111111-1111-1111-1111-111111111111",
      shortfallMinor: "50000000",
      currency: "INR",
    });
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CommandRefusal");
    expect(err.code).toBe("OVER_APPROPRIATION");
    expect(err.params).toMatchObject({ shortfallMinor: "50000000", currency: "INR" });
    // D-20 / house rule 4: money is bigint minor units as a string + ISO code, never a float.
    expect(typeof err.params.shortfallMinor).toBe("string");
    expect(err.retryable).toBe(false);
    expect(isCommandRefusal(err)).toBe(true);
  });

  it("defaults its internal message to the code and keeps it off the public surface", () => {
    const err = new CommandRefusal("PERIOD_CLOSED");
    expect(err.message).toBe("PERIOD_CLOSED");
    expect(err.params).toEqual({});
    // An explicit operator message is kept internal only (never returned by getCommandResult).
    const withMsg = new CommandRefusal("SOD_VIOLATION", { stage: "2" }, "maker 7 equals checker 7 on bill 9");
    expect(withMsg.message).toContain("bill 9");
    expect(withMsg.code).toBe("SOD_VIOLATION");
  });

  it("isCommandRefusal is false for a plain NonRetryableError or Error", () => {
    expect(isCommandRefusal(new NonRetryableError("x"))).toBe(false);
    expect(isCommandRefusal(new Error("y"))).toBe(false);
    expect(isCommandRefusal(null)).toBe(false);
    expect(isCommandRefusal("OVER_APPROPRIATION")).toBe(false);
  });
});

describe("refusalCodeOf", () => {
  it("returns a CommandRefusal's own code", () => {
    expect(refusalCodeOf(new CommandRefusal("OVER_APPROPRIATION"))).toBe("OVER_APPROPRIATION");
  });

  it("parses the legacy '[scope] CODE: ...' convention (gl/refusal.ts shape)", () => {
    expect(refusalCodeOf(new Error("[finance/payments] OVER_APPROPRIATION: bill exceeds allocation"))).toBe(
      "OVER_APPROPRIATION",
    );
    expect(refusalCodeOf(new Error("[asset] PERIOD_CLOSED: cannot re-date into a closed period"))).toBe(
      "PERIOD_CLOSED",
    );
  });

  it("parses a bare leading 'CODE: ...' / 'CODE - ...'", () => {
    expect(refusalCodeOf(new Error("PERIOD_CLOSED: closed"))).toBe("PERIOD_CLOSED");
    expect(refusalCodeOf(new Error("UNKNOWN_ACCOUNT_CODE - no such head"))).toBe("UNKNOWN_ACCOUNT_CODE");
  });

  it("prefers an explicit string `code` property matching the token shape", () => {
    expect(refusalCodeOf({ code: "SOD_VIOLATION", message: "whatever" })).toBe("SOD_VIOLATION");
  });

  it("falls back to REFUSED when nothing parseable is present (never free text)", () => {
    expect(refusalCodeOf(new Error("something went wrong, lowercase"))).toBe(DEFAULT_REFUSAL_CODE);
    expect(refusalCodeOf(null)).toBe(DEFAULT_REFUSAL_CODE);
    expect(refusalCodeOf(undefined)).toBe(DEFAULT_REFUSAL_CODE);
    expect(refusalCodeOf({})).toBe(DEFAULT_REFUSAL_CODE);
    // Only ever an uppercase token or the default — never leaks the message text.
    expect(refusalCodeOf(new Error("mixed Case Words"))).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });
});

describe("isEventShapedTopic", () => {
  it("flags past-tense event tails", () => {
    for (const t of ["finance.gl.posted", "finance.gl.rejected", "payroll.run.disbursed", "billing.invoice.paid"]) {
      expect(isEventShapedTopic(t)).toBe(true);
    }
  });
  it("does not flag imperative command tails", () => {
    for (const t of ["finance.bill.create", "payroll.run.repost", "finance.payment.approve", "asset.dep_entry.repost"]) {
      expect(isEventShapedTopic(t)).toBe(false);
    }
  });
});

describe("subscribeCommand", () => {
  function fakeQueue() {
    const subscribed: Array<{ topic: string; options: unknown }> = [];
    const queue = {
      subscribe: vi.fn((topic: string, _h: unknown, options: unknown) => {
        subscribed.push({ topic, options });
      }),
    } as unknown as import("@civitasone/queue").Queue;
    return { queue, subscribed };
  }

  it("refuses an event-shaped topic (silo safety) before subscribing", () => {
    const { queue } = fakeQueue();
    expect(() =>
      subscribeCommand(queue, "finance.gl.rejected", async () => {}, async () => {}),
    ).toThrow(/event-shaped topic/);
    expect((queue.subscribe as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("subscribes a command topic and records the outcome, composing any caller onOutcome", async () => {
    const { queue, subscribed } = fakeQueue();
    const recorded: CommandOutcome[] = [];
    const callerSeen: CommandOutcome[] = [];
    subscribeCommand(
      queue,
      "finance.bill.create",
      async () => {},
      async (o) => {
        recorded.push(o);
      },
      { onOutcome: async (o) => void callerSeen.push(o) },
    );
    expect(subscribed).toHaveLength(1);
    const options = subscribed[0]!.options as { onOutcome: (o: CommandOutcome) => Promise<void> };
    const outcome: CommandOutcome = {
      messageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      topic: "finance.bill.create",
      status: "rejected",
      reason: "[finance/payments] OVER_APPROPRIATION: nope",
    };
    await options.onOutcome(outcome);
    expect(recorded).toEqual([outcome]);
    expect(callerSeen).toEqual([outcome]);
  });
});

describe("outcomeToResultInput", () => {
  it("derives a code from the reason for a non-success outcome, marks failed retryable", () => {
    const failed = outcomeToResultInput({
      messageId: "m",
      tenantId: "t",
      topic: "finance.bill.create",
      status: "failed",
      reason: "PERIOD_CLOSED: downstream unavailable",
    });
    expect(failed.code).toBe("PERIOD_CLOSED");
    expect(failed.retryable).toBe(true);
  });
  it("leaves code unset and non-retryable for a success", () => {
    const ok = outcomeToResultInput({ messageId: "m", tenantId: "t", topic: "finance.bill.create", status: "succeeded" });
    expect(ok.code).toBeUndefined();
    expect(ok.retryable).toBe(false);
  });
});

describe("makeRecordOutcome", () => {
  it("runs recordCommandResult inside the caller-supplied tenant transaction", async () => {
    const calls: Array<{ tenantId: string }> = [];
    const fakeTx = {
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
    } as unknown as DrizzleTx;
    const record = makeRecordOutcome(async (tenantId, fn) => {
      calls.push({ tenantId });
      await fn(fakeTx);
    });
    await record({ messageId: "m", tenantId: "tenant-9", topic: "finance.bill.create", status: "succeeded" });
    expect(calls).toEqual([{ tenantId: "tenant-9" }]);
  });
});

describe("COMMAND_RESULT_RETENTION (D-20)", () => {
  it("keeps rejected/failed 30 days and succeeded 7 days", () => {
    expect(COMMAND_RESULT_RETENTION.rejected).toBe(30);
    expect(COMMAND_RESULT_RETENTION.failed).toBe(30);
    expect(COMMAND_RESULT_RETENTION.succeeded).toBe(7);
  });
  it("is frozen (single source of truth, not mutable at runtime)", () => {
    expect(Object.isFrozen(COMMAND_RESULT_RETENTION)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live Postgres: the §2.4 guarded upsert against a real driver.
// ---------------------------------------------------------------------------
// NOT skipped: these suites always run. CI's `Tests` job provisions Postgres on
// localhost:5435 (civitas/civitas_test, DB civitas_test — no service owns that DB or
// its `_inbox` schema), so the default below works there with no extra env. Locally,
// point COMMAND_RESULT_PG_URL at a disposable Postgres. A separate var from
// DATABASE_URL on purpose: setting DATABASE_URL would also switch on the unrelated
// *-live-pg suites, which need their own schema. A missing database fails loudly in
// beforeAll instead of silently skipping (flaky-skip-guard / REL-014).
const COMMAND_RESULT_PG_URL =
  process.env.COMMAND_RESULT_PG_URL ?? "postgres://civitas:civitas_test@localhost:5435/civitas_test";
const client = postgres(COMMAND_RESULT_PG_URL, { max: 4 });
const db = drizzle(client) as unknown as DrizzleTx;

const TENANT = "99999999-9999-9999-9999-999999999999";

async function ensureSchema(): Promise<void> {
  // The evolved _inbox.command_results shape (index.ts / 03-designs/FF-01.md
  // §2.3). Every FF-01-added column is nullable or defaulted.
  await client`CREATE SCHEMA IF NOT EXISTS _inbox`;
  await client`
    CREATE TABLE IF NOT EXISTS _inbox.command_results (
      message_id     uuid PRIMARY KEY,
      tenant_id      uuid NOT NULL,
      topic          varchar(128) NOT NULL,
      status         varchar(16)  NOT NULL,
      reason         text,
      occurred_at    timestamptz  NOT NULL DEFAULT now(),
      code           varchar(64),
      params         jsonb,
      actor_id       uuid,
      correlation_id varchar(64),
      resource_type  varchar(64),
      resource_id    uuid,
      attempts       int          NOT NULL DEFAULT 1,
      retryable      boolean      NOT NULL DEFAULT false,
      updated_at     timestamptz  NOT NULL DEFAULT now()
    )`;
}

// Regression (review round 1): the LIVE procurement 0039 / notification 0048 tables
// have ONLY the six original columns. recordCommandOutcome()/getCommandOutcome()
// must keep working against that exact shape until the B/C migrations add the
// FF-01 columns (zero-downtime expand step). Runs before the evolved-shape suite
// and drops the table afterwards so ensureSchema() recreates the evolved shape.
describe("recordCommandOutcome - legacy 6-column table (live Postgres, 0039/0048 shape)", () => {
  beforeAll(async () => {
    await client`CREATE SCHEMA IF NOT EXISTS _inbox`;
    await client`DROP TABLE IF EXISTS _inbox.command_results`;
    await client`
      CREATE TABLE _inbox.command_results (
        message_id  uuid PRIMARY KEY,
        tenant_id   uuid NOT NULL,
        topic       varchar(128) NOT NULL,
        status      varchar(16)  NOT NULL,
        reason      text,
        occurred_at timestamptz  NOT NULL DEFAULT now()
      )`;
  });
  afterAll(async () => {
    await client`DROP TABLE IF EXISTS _inbox.command_results`;
  });

  it("records and reads back an outcome without referencing any FF-01 column", async () => {
    const messageId = crypto.randomUUID();
    await db.transaction((tx) =>
      recordCommandOutcome(tx, { messageId, tenantId: TENANT, topic: "procurement.tender.publish", status: "rejected", reason: "BIDDING_CLOSED" }),
    );
    const got = await getCommandOutcome(db, TENANT, messageId);
    expect(got).not.toBeNull();
    expect(got!.status).toBe("rejected");
    expect(got!.reason).toBe("BIDDING_CLOSED");
    expect(await getCommandOutcome(db, "88888888-8888-8888-8888-888888888888", messageId)).toBeNull();
  });

  it("is idempotent on redelivery (ON CONFLICT DO NOTHING keeps the first outcome)", async () => {
    const messageId = crypto.randomUUID();
    await db.transaction((tx) =>
      recordCommandOutcome(tx, { messageId, tenantId: TENANT, topic: "t", status: "succeeded" }),
    );
    await db.transaction((tx) =>
      recordCommandOutcome(tx, { messageId, tenantId: TENANT, topic: "t", status: "failed", reason: "later" }),
    );
    expect((await getCommandOutcome(db, TENANT, messageId))!.status).toBe("succeeded");
  });
});

describe("recordCommandResult — guarded upsert (live Postgres, §2.4)", () => {
  beforeAll(async () => {
    await ensureSchema();
  });
  afterAll(async () => {
    await client.end({ timeout: 0 });
  });

  it("rejected then succeeded flips the row and increments attempts; a late rejected cannot downgrade", async () => {
    const messageId = crypto.randomUUID();
    await db.transaction((tx) =>
      recordCommandResult(tx, {
        messageId,
        tenantId: TENANT,
        topic: "finance.bill.create",
        status: "rejected",
        code: "OVER_APPROPRIATION",
        params: { shortfallMinor: "50000000", currency: "INR" },
        reason: "[finance/payments] OVER_APPROPRIATION: internal detail",
      }),
    );

    let view = await getCommandResult(db, TENANT, messageId);
    expect(view?.status).toBe("rejected");
    expect(view?.code).toBe("OVER_APPROPRIATION");
    expect(view?.attempts).toBe(1);

    // Legitimate deterministic-id retry succeeds (D-20).
    await db.transaction((tx) =>
      recordCommandResult(tx, { messageId, tenantId: TENANT, topic: "finance.bill.create", status: "succeeded" }),
    );
    view = await getCommandResult(db, TENANT, messageId);
    expect(view?.status).toBe("succeeded");
    expect(view?.code).toBeNull();
    expect(view?.attempts).toBe(2);

    // A late rejected must NOT downgrade a succeeded (invariant I1).
    await db.transaction((tx) =>
      recordCommandResult(tx, {
        messageId,
        tenantId: TENANT,
        topic: "finance.bill.create",
        status: "rejected",
        code: "OVER_APPROPRIATION",
      }),
    );
    view = await getCommandResult(db, TENANT, messageId);
    expect(view?.status).toBe("succeeded");
    expect(view?.attempts).toBe(2); // guard matched 0 rows, nothing changed
  });

  it("getCommandResult exposes code+params and resource but NEVER the free-text reason (D-20)", async () => {
    const messageId = crypto.randomUUID();
    const resourceId = crypto.randomUUID();
    await db.transaction((tx) =>
      recordCommandResult(tx, {
        messageId,
        tenantId: TENANT,
        topic: "finance.bill.create",
        status: "rejected",
        code: "PERIOD_CLOSED",
        params: { period: "2026-03" },
        reason: "SECRET operator-only detail that must never reach a client",
        resourceType: "bill",
        resourceId,
      }),
    );
    const view = await getCommandResult(db, TENANT, messageId);
    expect(view).not.toBeNull();
    expect(view!.code).toBe("PERIOD_CLOSED");
    expect(view!.params).toEqual({ period: "2026-03" });
    expect(view!.resource).toEqual({ type: "bill", id: resourceId });
    // The returned view object has no `reason` key at all.
    expect(Object.keys(view!)).not.toContain("reason");
    expect(JSON.stringify(view)).not.toContain("operator-only detail");
  });

  it("returns null for an unknown id (processing) and for another tenant's id (isolation)", async () => {
    const messageId = crypto.randomUUID();
    await db.transaction((tx) =>
      recordCommandResult(tx, { messageId, tenantId: TENANT, topic: "finance.bill.create", status: "succeeded" }),
    );
    expect(await getCommandResult(db, TENANT, crypto.randomUUID())).toBeNull();
    const otherTenant = "88888888-8888-8888-8888-888888888888";
    expect(await getCommandResult(db, otherTenant, messageId)).toBeNull();
  });
});
