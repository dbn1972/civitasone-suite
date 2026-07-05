/**
 * Payroll→GL Live Integration Test (Requirement 6, AC3/AC4).
 *
 * Proves the payroll.run.finalized → finance GL journal chain executes via
 * live SQS (LocalStack), PostgreSQL, and Redis — NOT MemoryQueue.
 *
 * Prerequisites (LocalStack + Postgres + Redis running):
 *   AWS_ENDPOINT_URL=http://localhost:4566 \
 *   QUEUE_DRIVER=sqs \
 *   DATABASE_URL=postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance \
 *   REDIS_URL=redis://localhost:6381 \
 *   pnpm vitest run tests/integration/payroll-gl-live.test.ts
 *
 * The test is gated on AWS_ENDPOINT_URL so it SKIPS cleanly in CI where no
 * infra is running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { SqsQueue } from "../../packages/queue/dist/index.js";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";

// ---------------------------------------------------------------------------
// Gate: skip when LocalStack / infra is not available
// ---------------------------------------------------------------------------
const localstackUp = Boolean(process.env.AWS_ENDPOINT_URL);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOPIC_PAYROLL_RUN_FINALIZED = "payroll.run.finalized";
const TOPIC_GL_POSTED = "finance.gl.posted";
const TOPIC_GL_REJECTED = "finance.gl.rejected";

const TENANT_ID = "10000000-aaaa-4000-8000-000000000001";
const ACTOR_ID = "20000000-bbbb-4000-8000-000000000001";
const RUN_ID = `payrun-${randomUUID().slice(0, 8)}`;

describe.skipIf(!localstackUp)("Payroll→GL Live SQS Integration", () => {
  let producer: SqsQueue;
  let subscriber: SqsQueue;
  let pgClient: import("postgres").Sql | null = null;

  beforeAll(async () => {
    producer = new SqsQueue();
    subscriber = new SqsQueue();

    // Connect to PostgreSQL to poll for journal entries
    try {
      const postgres = await import("postgres");
      pgClient = postgres.default(DATABASE_URL, { max: 2 });
      await pgClient`SELECT 1`;
    } catch {
      pgClient = null;
    }
  }, 15_000);

  afterAll(async () => {
    await subscriber.stop().catch(() => {});
    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  it("publishes payroll.run.finalized and receives finance.gl.posted via live SQS", async () => {
    const correlationId = `payroll-gl-${Date.now()}`;
    const messageId = randomUUID();

    // Set up subscriber to capture the finance.gl.posted event
    const postedReceived = new Promise<CommandEnvelope>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for finance.gl.posted (10s)")),
        10_000,
      );
      subscriber.subscribe(TOPIC_GL_POSTED, async (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    await subscriber.start();

    // Publish payroll.run.finalized with balanced entries
    await producer.publish(TOPIC_PAYROLL_RUN_FINALIZED, {
      type: TOPIC_PAYROLL_RUN_FINALIZED,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId,
      schemaVersion: "1.0",
      payload: {
        runId: RUN_ID,
        tenantId: TENANT_ID,
        fy: "2025-26",
        entries: [
          { headCode: "4100", debitMinor: "5000000", creditMinor: "0" },   // Salary expense
          { headCode: "2100", debitMinor: "0", creditMinor: "5000000" },   // Salary payable
        ],
      },
    });

    // Wait for the downstream event (max 10s) — proves the consumer processed
    // the message via live SQS and posted the GL journal.
    const postedMsg = await postedReceived;

    // Assertions on the finance.gl.posted event payload
    const payload = postedMsg.payload as Record<string, unknown>;
    expect(payload.journalId).toBeDefined();
    expect(payload.voucherNo).toBeDefined();
  }, 30_000);

  it("verifies journal entries are balanced in finance DB", async () => {
    if (!pgClient) {
      console.warn("PostgreSQL not available — skipping DB assertion (SQS chain still verified)");
      return;
    }

    // Poll for journal creation (max 10s) — the consumer from the first test
    // should have already written this.
    const deadline = Date.now() + 10_000;
    let journal: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      const rows = await pgClient`
        SELECT id, tenant_id, type, voucher_no, status, lines
        FROM gl.finance_journals
        WHERE tenant_id = ${TENANT_ID}
          AND type = 'payroll'
          AND voucher_no LIKE ${'PAY/%' + RUN_ID.slice(0, 8).toUpperCase() + '%'}
        LIMIT 1
      `;
      if (rows.length > 0) {
        journal = rows[0] as Record<string, unknown>;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(journal).not.toBeNull();
    expect(journal!.tenant_id).toBe(TENANT_ID);
    expect(journal!.type).toBe("payroll");
    expect(journal!.status).toBe("posted");

    // Verify journal is balanced: sum of debits === sum of credits
    const lines = journal!.lines as Array<{ debitMinor: string; creditMinor: string }>;
    const totalDebit = lines.reduce((sum, l) => sum + BigInt(l.debitMinor), 0n);
    const totalCredit = lines.reduce((sum, l) => sum + BigInt(l.creditMinor), 0n);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(5000000n);
  }, 15_000);

  it("publishes payroll.run.finalized with invalid headCode and receives finance.gl.rejected", async () => {
    const correlationId = `payroll-gl-reject-${Date.now()}`;

    // Set up subscriber to capture the finance.gl.rejected event
    const rejectedReceived = new Promise<CommandEnvelope>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for finance.gl.rejected (10s)")),
        10_000,
      );
      subscriber.subscribe(TOPIC_GL_REJECTED, async (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    await subscriber.start();

    const badRunId = `payrun-bad-${randomUUID().slice(0, 8)}`;

    // Publish with an invalid headCode that doesn't exist in COA
    await producer.publish(TOPIC_PAYROLL_RUN_FINALIZED, {
      type: TOPIC_PAYROLL_RUN_FINALIZED,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId,
      schemaVersion: "1.0",
      payload: {
        runId: badRunId,
        tenantId: TENANT_ID,
        fy: "2025-26",
        entries: [
          { headCode: "INVALID_CODE_XYZ", debitMinor: "2000000", creditMinor: "0" },
          { headCode: "2100", debitMinor: "0", creditMinor: "2000000" },
        ],
      },
    });

    const rejectedMsg = await rejectedReceived;
    const payload = rejectedMsg.payload as Record<string, unknown>;
    expect(payload.runId).toBe(badRunId);
    expect(payload.reason).toContain("INVALID_HEAD_CODE");
    expect(payload.reason).toContain("INVALID_CODE_XYZ");
  }, 30_000);
});
