import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const selectArgs: unknown[] = [];
const rows: Array<Record<string, unknown>> = [];
vi.mock("../src/shared/scanner-db.js", () => ({
  scannerDb: {
    select: (fields?: unknown) => {
      selectArgs.push(fields);
      return { from: () => ({ where: async () => rows }) };
    },
  },
}));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: vi.fn(async () => undefined) } }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn(async () => undefined) }));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: { getOrLoad: vi.fn(async () => "1"), put: vi.fn(async () => undefined) },
}));

import { runHealthCheck } from "../src/modules/device-registry/health-checker.js";

/**
 * REGRESSION (UAT 9 Nov, visitor-worker log): the 30 s health-check cycle did select() of every column
 * of every active device across all tenants, which decrypts device_token_hash / old_token_hash. One row
 * that cannot be decrypted (device 3149aa8f..., tenant 67fc1140) threw PiiDecryptError and aborted the
 * cycle for ALL tenants, so offline detection was dead everywhere. The checker never needs the token
 * columns, so it must not select them.
 */
describe("device health checker: never selects encrypted token columns", () => {
  beforeEach(() => { selectArgs.length = 0; rows.length = 0; });

  it("projects an explicit column list that excludes the encrypted token hashes", async () => {
    rows.push({
      id: randomUUID(), tenantId: randomUUID(), locationId: randomUUID(), deviceType: "kiosk",
      name: "Main gate kiosk", status: "active", online: true, lastSeenAt: new Date(),
    });
    await runHealthCheck();
    const fields = selectArgs[0] as Record<string, unknown> | undefined;
    expect(fields).toBeDefined();
    expect(Object.keys(fields!)).not.toContain("deviceTokenHash");
    expect(Object.keys(fields!)).not.toContain("oldTokenHash");
    expect(Object.keys(fields!)).toEqual(
      expect.arrayContaining(["id", "tenantId", "locationId", "deviceType", "name", "status", "online", "lastSeenAt"]),
    );
  });
});
