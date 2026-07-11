/**
 * VC-integration — presenter (secret-strip) tests.
 *
 * Asserts the client-safe projection: internal identifiers (externalId,
 * recordingStorageKey) are ALWAYS dropped; the dial-in PIN is returned only to
 * session hosts.
 */
import { describe, it, expect } from "vitest";
import { toPublicVcSession, type VcSessionInternal } from "../src/modules/vc-integration/presenter.js";

const internal: VcSessionInternal = {
  id: "11111111-0000-4000-8000-000000000001",
  meetingId: "22222222-0000-4000-8000-000000000002",
  provider: "nic_vc",
  externalId: "provider-session-abc-secret",
  joinUrl: "https://vc.example/join/xyz",
  dialInNumber: "+91-11-4000-0000",
  meetingPin: "834192",
  recordingUrl: "https://cdn.example/rec.mp4",
  recordingStorageKey: "meeting/rec/2026/abc.mp4",
  status: "active",
  startedAt: "2026-07-11T10:00:00.000Z",
  endedAt: null,
  failureReason: null,
};

describe("toPublicVcSession", () => {
  it("ALWAYS strips externalId and recordingStorageKey (host or not)", () => {
    for (const includeHostSecrets of [true, false]) {
      const pub = toPublicVcSession(internal, { includeHostSecrets }) as Record<string, unknown>;
      expect(pub).not.toHaveProperty("externalId");
      expect(pub).not.toHaveProperty("recordingStorageKey");
      expect(JSON.stringify(pub)).not.toContain("provider-session-abc-secret");
      expect(JSON.stringify(pub)).not.toContain("meeting/rec/2026/abc.mp4");
    }
  });

  it("returns the dial-in PIN to hosts", () => {
    expect(toPublicVcSession(internal, { includeHostSecrets: true }).meetingPin).toBe("834192");
  });

  it("nulls the dial-in PIN for non-host readers", () => {
    expect(toPublicVcSession(internal, { includeHostSecrets: false }).meetingPin).toBeNull();
  });

  it("preserves join info + status for all readers", () => {
    const pub = toPublicVcSession(internal, { includeHostSecrets: false });
    expect(pub.joinUrl).toBe("https://vc.example/join/xyz");
    expect(pub.dialInNumber).toBe("+91-11-4000-0000");
    expect(pub.status).toBe("active");
    expect(pub.provider).toBe("nic_vc");
  });
});
