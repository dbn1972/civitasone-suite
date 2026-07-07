/**
 * Tests for the tenant deletion purge handler.
 *
 * Validates: Requirements 17.6, 23.3
 *   - Consumes `tenant.deleted` event
 *   - Deletes all ml_models, ml_predictions, ml_feature_vectors, ml_training_runs for the tenant
 *   - Deletes S3 objects under `ml-models/{tenantId}/` prefix
 *   - Idempotent (duplicate events do not cause errors)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────

// Mock @civitasone/storage
const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
vi.mock("@civitasone/storage", () => ({
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  putObject: vi.fn().mockResolvedValue(undefined),
  presignedGetUrl: vi.fn().mockResolvedValue("https://s3.example.com/signed"),
  presignedPutUrl: vi.fn().mockResolvedValue("https://s3.example.com/signed"),
  getObject: vi.fn().mockResolvedValue(Buffer.from("{}")),
  objectExists: vi.fn().mockResolvedValue(false),
  resetClient: vi.fn(),
  bucketName: vi.fn().mockReturnValue("civitasone"),
}));

// Mock @aws-sdk/client-s3 ListObjectsV2Command
const mockS3Send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
    ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ input })),
    DeleteObjectCommand: vi.fn(),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    HeadObjectCommand: vi.fn(),
  };
});

// Track delete calls to get the table references
const deleteReturningMock = vi.fn().mockResolvedValue([]);
const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });
const mockDbDelete = vi.fn().mockReturnValue({ where: deleteWhereMock });
const mockMarkProcessed = vi.fn().mockResolvedValue(true);

// Mock shared/db — the real module connects to PostgreSQL
vi.mock("../src/shared/db.js", () => ({
  db: {
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

// Mock outbox
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  enqueue: vi.fn(),
  startRelay: vi.fn(),
}));

// Mock cache
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
    getOrLoad: vi.fn(),
  },
  queue: {
    subscribe: vi.fn(),
    publish: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  purgeTenantData,
  deleteS3ObjectsByTenantPrefix,
  registerPurgeConsumer,
} from "../src/modules/purge/consumer.js";
import type { Queue } from "@civitasone/queue";

// ─── Tests ───────────────────────────────────────────────────────

describe("tenant purge handler", () => {
  const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults
    deleteReturningMock.mockResolvedValue([]);
    deleteWhereMock.mockReturnValue({ returning: deleteReturningMock });
    mockDbDelete.mockReturnValue({ where: deleteWhereMock });
    mockS3Send.mockResolvedValue({ Contents: [], IsTruncated: false });
    mockMarkProcessed.mockResolvedValue(true);
  });

  describe("deleteS3ObjectsByTenantPrefix", () => {
    it("lists and deletes all S3 objects under the tenant prefix", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: `ml-models/${TENANT_ID}/leads/1/model.json` },
          { Key: `ml-models/${TENANT_ID}/tickets/2/model.json` },
          { Key: `ml-models/${TENANT_ID}/inventory/1/model.json` },
        ],
        IsTruncated: false,
      });

      const deleted = await deleteS3ObjectsByTenantPrefix(TENANT_ID);

      expect(deleted).toBe(3);
      expect(mockDeleteObject).toHaveBeenCalledTimes(3);
      expect(mockDeleteObject).toHaveBeenCalledWith(`ml-models/${TENANT_ID}/leads/1/model.json`);
      expect(mockDeleteObject).toHaveBeenCalledWith(`ml-models/${TENANT_ID}/tickets/2/model.json`);
      expect(mockDeleteObject).toHaveBeenCalledWith(`ml-models/${TENANT_ID}/inventory/1/model.json`);
    });

    it("handles paginated S3 listing", async () => {
      mockS3Send
        .mockResolvedValueOnce({
          Contents: [{ Key: `ml-models/${TENANT_ID}/leads/1/model.json` }],
          IsTruncated: true,
          NextContinuationToken: "token-1",
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: `ml-models/${TENANT_ID}/leads/2/model.json` }],
          IsTruncated: false,
        });

      const deleted = await deleteS3ObjectsByTenantPrefix(TENANT_ID);

      expect(deleted).toBe(2);
      expect(mockS3Send).toHaveBeenCalledTimes(2);
      expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    });

    it("returns 0 when no S3 objects exist for tenant", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [],
        IsTruncated: false,
      });

      const deleted = await deleteS3ObjectsByTenantPrefix(TENANT_ID);

      expect(deleted).toBe(0);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("continues deletion even when individual object deletion fails", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: `ml-models/${TENANT_ID}/leads/1/model.json` },
          { Key: `ml-models/${TENANT_ID}/leads/2/model.json` },
          { Key: `ml-models/${TENANT_ID}/leads/3/model.json` },
        ],
        IsTruncated: false,
      });

      mockDeleteObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("S3 delete failed"))
        .mockResolvedValueOnce(undefined);

      const deleted = await deleteS3ObjectsByTenantPrefix(TENANT_ID);

      // 2 successful deletions (first and third)
      expect(deleted).toBe(2);
      expect(mockDeleteObject).toHaveBeenCalledTimes(3);
    });

    it("handles undefined Contents in S3 response", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: undefined,
        IsTruncated: false,
      });

      const deleted = await deleteS3ObjectsByTenantPrefix(TENANT_ID);

      expect(deleted).toBe(0);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  describe("purgeTenantData", () => {
    it("deletes all ML data for a tenant (4 table deletions)", async () => {
      deleteReturningMock.mockResolvedValue([{ id: "mock-id" }]);

      const result = await purgeTenantData(TENANT_ID);

      // Verify all 4 table types were targeted for deletion
      expect(mockDbDelete).toHaveBeenCalledTimes(4);
      expect(result.modelsDeleted).toBe(1);
      expect(result.predictionsDeleted).toBe(1);
      expect(result.featureVectorsDeleted).toBe(1);
      expect(result.trainingRunsDeleted).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reports correct counts when multiple records exist per table", async () => {
      const mockIds = [{ id: "a" }, { id: "b" }, { id: "c" }];
      deleteReturningMock.mockResolvedValue(mockIds);

      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: `ml-models/${TENANT_ID}/leads/1/model.json` },
          { Key: `ml-models/${TENANT_ID}/tickets/1/model.json` },
        ],
        IsTruncated: false,
      });

      const result = await purgeTenantData(TENANT_ID);

      expect(result.modelsDeleted).toBe(3);
      expect(result.predictionsDeleted).toBe(3);
      expect(result.featureVectorsDeleted).toBe(3);
      expect(result.trainingRunsDeleted).toBe(3);
      expect(result.s3ObjectsDeleted).toBe(2);
    });

    it("handles zero records gracefully (new tenant with no ML data)", async () => {
      deleteReturningMock.mockResolvedValue([]);

      const result = await purgeTenantData(TENANT_ID);

      expect(result.modelsDeleted).toBe(0);
      expect(result.predictionsDeleted).toBe(0);
      expect(result.featureVectorsDeleted).toBe(0);
      expect(result.trainingRunsDeleted).toBe(0);
      expect(result.s3ObjectsDeleted).toBe(0);
    });

    it("continues even if S3 deletion fails entirely", async () => {
      deleteReturningMock.mockResolvedValue([{ id: "x" }]);
      mockS3Send.mockRejectedValueOnce(new Error("S3 connection refused"));

      const result = await purgeTenantData(TENANT_ID);

      // Database records still deleted successfully
      expect(result.modelsDeleted).toBe(1);
      expect(result.predictionsDeleted).toBe(1);
      expect(result.featureVectorsDeleted).toBe(1);
      expect(result.trainingRunsDeleted).toBe(1);
      // S3 deletion failed
      expect(result.s3ObjectsDeleted).toBe(0);
    });

    it("invalidates Redis cache for the tenant across all domains", async () => {
      deleteReturningMock.mockResolvedValue([]);

      await purgeTenantData(TENANT_ID);

      // Should invalidate cache for all 6 domains
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:leads:current`);
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:tickets:current`);
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:inventory:current`);
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:subscriptions:current`);
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:tasks:current`);
      expect(mockCacheInvalidate).toHaveBeenCalledWith(`ml:${TENANT_ID}:model:transactions:current`);
    });

    it("records duration in the result", async () => {
      deleteReturningMock.mockResolvedValue([]);

      const result = await purgeTenantData(TENANT_ID);

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("registerPurgeConsumer", () => {
    it("subscribes to tenant.deleted topic", () => {
      const mockSubscribe = vi.fn();
      const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

      registerPurgeConsumer(mockQueue);

      expect(mockSubscribe).toHaveBeenCalledWith("tenant.deleted", expect.any(Function));
    });

    it("consumer handler calls markProcessed for idempotency", async () => {
      const mockSubscribe = vi.fn();
      const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

      registerPurgeConsumer(mockQueue);

      const handler = mockSubscribe.mock.calls[0]![1] as (msg: unknown) => Promise<void>;
      const msg = {
        messageId: "msg-123",
        type: "tenant.deleted",
        tenantId: TENANT_ID,
        payload: { tenantId: TENANT_ID, deletedAt: new Date().toISOString() },
      };

      deleteReturningMock.mockResolvedValue([]);

      await handler(msg);

      expect(mockMarkProcessed).toHaveBeenCalledWith({}, "msg-123");
    });

    it("consumer handler skips already-processed messages", async () => {
      const mockSubscribe = vi.fn();
      const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

      registerPurgeConsumer(mockQueue);

      const handler = mockSubscribe.mock.calls[0]![1] as (msg: unknown) => Promise<void>;
      const msg = {
        messageId: "msg-duplicate",
        type: "tenant.deleted",
        tenantId: TENANT_ID,
        payload: { tenantId: TENANT_ID },
      };

      // markProcessed returns false → already processed
      mockMarkProcessed.mockResolvedValueOnce(false);

      await handler(msg);

      // No delete operations should happen
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("consumer handler skips messages with missing tenantId", async () => {
      const mockSubscribe = vi.fn();
      const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

      registerPurgeConsumer(mockQueue);

      const handler = mockSubscribe.mock.calls[0]![1] as (msg: unknown) => Promise<void>;
      const msg = {
        messageId: "msg-no-tenant",
        type: "tenant.deleted",
        tenantId: undefined,
        payload: {},
      };

      await handler(msg);

      // Should skip — no idempotency check or deletion
      expect(mockMarkProcessed).not.toHaveBeenCalled();
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("consumer handler re-throws on purge failure for DLQ", async () => {
      const mockSubscribe = vi.fn();
      const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

      registerPurgeConsumer(mockQueue);

      const handler = mockSubscribe.mock.calls[0]![1] as (msg: unknown) => Promise<void>;
      const msg = {
        messageId: "msg-fail",
        type: "tenant.deleted",
        tenantId: TENANT_ID,
        payload: { tenantId: TENANT_ID },
      };

      // Make the db.delete throw to simulate a failure
      mockDbDelete.mockImplementationOnce(() => {
        throw new Error("Database connection lost");
      });

      await expect(handler(msg)).rejects.toThrow("Database connection lost");
    });
  });
});
