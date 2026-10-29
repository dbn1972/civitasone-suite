/**
 * UAT FQ9-A (unit, no DB):
 *   #7  POST /v1/visitor/config/presets/:preset 504'd at ~15s — applyPreset awaited every
 *       queue.publish serially, so latency = sum of broker round trips.
 *   #31 the device bearer token must never travel in a command or event: it is minted on the request
 *       path, returned once, and only its SHA-256 hash is published.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const published: Array<{ topic: string; env: { payload: Record<string, unknown> } }> = [];
let inFlight = 0;
let maxInFlight = 0;

vi.mock("../src/shared/infra.js", () => ({
  queue: {
    publish: vi.fn(async (topic: string, env: { payload: Record<string, unknown> }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight--;
      published.push({ topic, env });
    }),
  },
  cache: {},
}));

const { applyPreset, getPreset } = await import("../src/modules/config-registry/presets.js");
const { publishDeviceRegister, publishDeviceRotateCredential } = await import("../src/modules/device-registry/commands.js");
const { COMMANDS } = await import("../src/topics.js");

const CTX = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  correlationId: "corr-fq9a",
  roles: ["tenant_admin"],
  sessionId: "s",
} as never;

beforeEach(() => {
  published.length = 0;
  inFlight = 0;
  maxInFlight = 0;
});

describe("#7 applyPreset publishes its config.set commands concurrently", () => {
  it("all entries are in flight at once (latency ≈ one round trip, not the sum)", async () => {
    const n = getPreset("secretariat")!.length;
    expect(n).toBeGreaterThan(1);
    const result = await applyPreset(CTX, "secretariat", "Onboarding a high-security office");
    expect(result).toEqual({ accepted: true, preset: "secretariat", entries: n });
    expect(published).toHaveLength(n);
    expect(maxInFlight).toBe(n);
    expect(new Set(published.map((p) => p.env.payload.configKey)).size).toBe(n);
  });

  it("still rejects when a publish fails", async () => {
    const infra = await import("../src/shared/infra.js");
    (infra.queue.publish as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("broker down");
    });
    await expect(applyPreset(CTX, "hospital", "Switching to the hospital policy")).rejects.toThrow("broker down");
  });
});

describe("#31 device credential: hash in the command, raw token only in the response", () => {
  it("register (bearer device) returns deviceToken and publishes only sha256(token)", async () => {
    const accepted = await publishDeviceRegister(CTX, {
      deviceType: "scanner", name: "s", serialNumber: "SN-1", locationId: "33333333-3333-4333-8333-333333333333",
    });
    expect(accepted.deviceToken).toMatch(/^device_[A-Za-z0-9_-]{64}$/);
    const cmd = published.find((p) => p.topic === COMMANDS.deviceRegister)!;
    expect(cmd.env.payload.tokenHash).toBe(createHash("sha256").update(accepted.deviceToken!).digest("hex"));
    expect(JSON.stringify(cmd.env)).not.toContain(accepted.deviceToken!);
    expect(cmd.env.payload).not.toHaveProperty("token");
  });

  it("register (mTLS device) mints no bearer token", async () => {
    const accepted = await publishDeviceRegister(CTX, {
      deviceType: "turnstile", name: "t", serialNumber: "SN-2", locationId: "33333333-3333-4333-8333-333333333333",
    });
    expect(accepted.deviceToken).toBeUndefined();
    expect(published.find((p) => p.topic === COMMANDS.deviceRegister)!.env.payload.tokenHash).toBeNull();
  });

  it("rotate returns the new token once and publishes only its hash", async () => {
    const accepted = await publishDeviceRotateCredential(CTX, { deviceId: "44444444-4444-4444-8444-444444444444" });
    expect(accepted.deviceToken).toMatch(/^device_/);
    const cmd = published.find((p) => p.topic === COMMANDS.deviceRotateCredential)!;
    expect(cmd.env.payload.tokenHash).toBe(createHash("sha256").update(accepted.deviceToken!).digest("hex"));
    expect(JSON.stringify(cmd.env)).not.toContain(accepted.deviceToken!);
  });
});
