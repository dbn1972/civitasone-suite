import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const published: Array<{ messageId: string }> = [];
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async (_t: string, env: { messageId: string }) => { published.push({ messageId: env.messageId }); }) },
  cache: { getOrLoad: vi.fn(async () => null), put: vi.fn(async () => undefined) },
}));

import { checkOfflineAlert } from "../src/modules/device-registry/health-checker.js";
import { OFFLINE_ALERT_DELAY_MS } from "../src/modules/device-registry/domain.js";

/**
 * REGRESSION (UAT messageId scan): the offline-alert NOTIFICATION_SEND messageId was a stable hash of
 * the per-device alert key with no time component, so after a device's first-ever alert every later
 * outage was dropped by notification-service's inbox. It is now per alert episode (device + the
 * lastSeenAt that opened the outage).
 */
describe("visitor offline alert: messageId per alert episode", () => {
  beforeEach(() => { published.length = 0; });

  const tenantId = randomUUID();
  const device = (lastSeenAt: Date) => ({
    id: "d1d1d1d1-0000-4000-8000-000000000001", name: "Gate cam", deviceType: "camera", locationId: randomUUID(), lastSeenAt,
  }) as never;

  it("the same outage re-checked reuses the id (retry dedup), a later outage of the same device gets a new id", async () => {
    const t0 = new Date("2026-10-01T10:00:00Z");
    const now1 = new Date(t0.getTime() + OFFLINE_ALERT_DELAY_MS + 60_000);
    await checkOfflineAlert(tenantId, device(t0), now1);
    await checkOfflineAlert(tenantId, device(t0), new Date(now1.getTime() + 30_000));
    expect(published[0]!.messageId).toBe(published[1]!.messageId);

    // device recovered, then went offline again: new lastSeenAt => new episode
    const t1 = new Date("2026-10-02T09:00:00Z");
    await checkOfflineAlert(tenantId, device(t1), new Date(t1.getTime() + OFFLINE_ALERT_DELAY_MS + 60_000));
    expect(published[2]!.messageId).not.toBe(published[0]!.messageId);
  });
});
