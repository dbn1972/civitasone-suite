/**
 * ExportConsumer integration tests — verifies the full write path:
 * command → queue → consumer → S3 upload → presigned URL → DB write.
 *
 * Covers:
 *  - Happy path CSV generation
 *  - Happy path JSON generation
 *  - File size limit enforcement (50MB)
 *  - Idempotency (duplicate message skipped)
 *  - Failed query source handling (missing/failed run)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { queryRuns } from "../src/modules/queries/schema.js";
import { exportJobs } from "../src/modules/exports/schema.js";
import { registerExportConsumer } from "../src/modules/exports/consumer.js";
import { COMMANDS } from "../src/topics.js";

// Mock @civitasone/storage so we don't need a real S3/MinIO instance.
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  presignedGetUrl: vi.fn().mockResolvedValue("https://s3.example.com/exports/signed-url"),
}));

const TENANT = randomUUID();
const ACTOR = randomUUID();
let queue: MemoryQueue;

function publishExport(id: string, queryRunId: string, format: "csv" | "json") {
  return queue.publish(COMMANDS.createExport, {
    messageId: id,
    type: COMMANDS.createExport,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${id}`,
    schemaVersion: "1.0",
    payload: { id, queryRunId, format },
  });
}

async function waitForExportJob(id: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    const rows = await db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.tenantId, TENANT)))
      .limit(1);
    const job = rows[0];
    if (job && (job.status === "completed" || job.status === "failed")) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  // Final attempt
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  const rows = await db
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.id, id), eq(exportJobs.tenantId, TENANT)))
    .limit(1);
  return rows[0] ?? null;
}

async function insertQueryRun(
  id: string,
  status: "completed" | "failed" | "running",
  result: Record<string, unknown> | null,
) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.insert(queryRuns).values({
    id,
    tenantId: TENANT,
    queryName: "test-query",
    status,
    kind: "adhoc",
    spec: {},
    result,
    resultRows: Array.isArray(result) ? result.length : 0,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  });
}

beforeAll(async () => {
  queue = new MemoryQueue();
  registerExportConsumer(queue);
  await queue.start();
});

afterAll(async () => {
  await queue.stop();
  // Clean up test data (set GUC for RLS-scoped deletes)
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.delete(exportJobs).where(eq(exportJobs.tenantId, TENANT));
  await db.delete(queryRuns).where(eq(queryRuns.tenantId, TENANT));
  await sqlClient.end();
});

describe("ExportConsumer", () => {
  describe("happy path — CSV generation", () => {
    it("processes export command, uploads CSV to S3, and marks job as completed with presigned URL", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      // Seed a completed query run with tabular data
      await insertQueryRun(queryRunId, "completed", {
        rows: [
          { department: "Finance", amount: 50000, month: "Jan" },
          { department: "HR", amount: 30000, month: "Jan" },
        ],
      });

      await publishExport(exportId, queryRunId, "csv");
      const job = await waitForExportJob(exportId);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("completed");
      expect(job!.fileKey).toBe(`exports/${TENANT}/${exportId}.csv`);
      expect(job!.downloadUrl).toBe("https://s3.example.com/exports/signed-url");
      expect(job!.expiresAt).toBeInstanceOf(Date);
      expect(job!.error).toBeNull();
      // Expiry should be ~24h from now
      const nowMs = Date.now();
      const expiryMs = job!.expiresAt!.getTime();
      expect(expiryMs - nowMs).toBeGreaterThan(23 * 60 * 60 * 1000); // > 23h
      expect(expiryMs - nowMs).toBeLessThan(25 * 60 * 60 * 1000); // < 25h
    });
  });

  describe("happy path — JSON generation", () => {
    it("processes export command, uploads JSON to S3, and marks job as completed", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      await insertQueryRun(queryRunId, "completed", {
        rows: [
          { id: "1", metric: "revenue", value: 100000 },
          { id: "2", metric: "expenses", value: 75000 },
        ],
      });

      await publishExport(exportId, queryRunId, "json");
      const job = await waitForExportJob(exportId);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("completed");
      expect(job!.fileKey).toBe(`exports/${TENANT}/${exportId}.json`);
      expect(job!.downloadUrl).toBe("https://s3.example.com/exports/signed-url");
      expect(job!.expiresAt).toBeInstanceOf(Date);
      expect(job!.fileSizeBytes).not.toBeNull();
      expect(job!.fileSizeBytes!).toBeGreaterThan(0n);
      expect(job!.error).toBeNull();
    });
  });

  describe("file size limit enforcement", () => {
    it("marks job as failed when generated content exceeds 50MB", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      // Create a large dataset that will exceed 50MB when serialized
      const bigRow: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        bigRow[`col_${i}`] = "x".repeat(1000);
      }
      // ~100KB per row × 600 rows = ~60MB (exceeds 50MB limit)
      const largeData = Array.from({ length: 600 }, () => ({ ...bigRow }));

      await insertQueryRun(queryRunId, "completed", { rows: largeData });

      await publishExport(exportId, queryRunId, "json");
      const job = await waitForExportJob(exportId);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.error).toContain("exceeds maximum allowed size");
      expect(job!.fileKey).toBeNull();
      expect(job!.downloadUrl).toBeNull();
    });
  });

  describe("idempotency — duplicate message skipped", () => {
    it("skips processing when the same messageId is delivered twice", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      await insertQueryRun(queryRunId, "completed", {
        rows: [{ x: 1 }],
      });

      // First delivery — should process normally
      await publishExport(exportId, queryRunId, "csv");
      const firstJob = await waitForExportJob(exportId);
      expect(firstJob).not.toBeNull();
      expect(firstJob!.status).toBe("completed");

      // Record state after first processing
      const firstUpdatedAt = firstJob!.updatedAt;

      // Small delay to ensure timestamps would differ if reprocessed
      await new Promise((r) => setTimeout(r, 100));

      // Second delivery of same messageId — should be skipped by markProcessed
      await publishExport(exportId, queryRunId, "csv");

      // Wait briefly for potential reprocessing
      await new Promise((r) => setTimeout(r, 500));

      // Verify the job was NOT reprocessed (updatedAt unchanged, status stable)
      await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
      const rows = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, exportId), eq(exportJobs.tenantId, TENANT)))
        .limit(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("completed");
      // The job should not have been modified by the second delivery
      expect(rows[0]!.updatedAt.getTime()).toBe(firstUpdatedAt.getTime());
    });
  });

  describe("failed query source handling", () => {
    it("marks job as failed when source query run does not exist", async () => {
      const nonExistentRunId = randomUUID();
      const exportId = randomUUID();

      // Ensure tenant GUC is initialized on the shared DB connection pool
      // (same as what insertQueryRun does for other tests)
      await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);

      await publishExport(exportId, nonExistentRunId, "csv");
      const job = await waitForExportJob(exportId, 10000);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.error).toContain("not found");
      expect(job!.fileKey).toBeNull();
      expect(job!.downloadUrl).toBeNull();
    }, 15000);

    it("marks job as failed when source query run has 'failed' status", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      await insertQueryRun(queryRunId, "failed", null);

      await publishExport(exportId, queryRunId, "csv");
      const job = await waitForExportJob(exportId);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.error).toContain("not completed successfully");
      expect(job!.fileKey).toBeNull();
      expect(job!.downloadUrl).toBeNull();
    });

    it("marks job as failed when source query run is still running", async () => {
      const queryRunId = randomUUID();
      const exportId = randomUUID();

      await insertQueryRun(queryRunId, "running", null);

      await publishExport(exportId, queryRunId, "csv");
      const job = await waitForExportJob(exportId);

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.error).toContain("not completed successfully");
    });
  });
});
