/** V4-F-03 regression: the purge consumer must reuse one S3Client, not build one per call. */
import { describe, it, expect, vi } from "vitest";

const ctor = vi.fn();
const send = vi.fn().mockResolvedValue({ Contents: [], IsTruncated: false });
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation((cfg: unknown) => {
    ctor(cfg);
    return { send, destroy: vi.fn() };
  }),
  ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ input })),
}));
vi.mock("@civitasone/storage", () => ({ deleteObject: vi.fn() }));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn(), markProcessed: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn() } }));

import { deleteS3ObjectsByTenantPrefix } from "../src/modules/purge/consumer.js";

describe("purge S3 client reuse (V4-F-03)", () => {
  it("constructs the S3Client once across repeated purges", async () => {
    await deleteS3ObjectsByTenantPrefix(globalThis.crypto.randomUUID());
    await deleteS3ObjectsByTenantPrefix(globalThis.crypto.randomUUID());
    await deleteS3ObjectsByTenantPrefix(globalThis.crypto.randomUUID());
    expect(send).toHaveBeenCalledTimes(3);
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
