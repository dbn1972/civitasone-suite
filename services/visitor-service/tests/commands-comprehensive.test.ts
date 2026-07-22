/**
 * Comprehensive tests for command publishing functions.
 * Tests that each command function publishes to the correct topic with proper payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMock = vi.fn(async () => undefined);

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publishMock(...args) },
  cache: { invalidate: vi.fn(), makeKey: (...a: unknown[]) => a.join(":") },
}));

const { COMMANDS } = await import("../src/topics.js");

const CTX = {
  tenantId: "t-1",
  actorId: "a-1",
  correlationId: "corr-1",
  roles: ["visitor_admin"],
};

beforeEach(() => { publishMock.mockReset().mockResolvedValue(undefined); });

// ── Visit Request Commands ────────────────────────────────────────────────
describe("visit-request/commands", () => {
  let mod: typeof import("../src/modules/visit-request/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/visit-request/commands.js"); });

  it("visitRequestCreate publishes correct topic", async () => {
    await mod.visitRequestCreate(CTX as never, {
      locationId: "loc-1", visitorName: "Jane", visitorPhone: "123",
      visitorEmail: null, purpose: "meeting", hostEmployeeId: "host-1",
      scheduledAt: "2025-06-15T10:00:00Z", passType: "single",
      identityDocType: null, identityDocRef: "ref",
      visitorCategory: "standard", source: "portal", permittedAreas: [],
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.visitRequestCreate, expect.objectContaining({ type: COMMANDS.visitRequestCreate }));
  });

  it("visitRequestApprove publishes correct topic", async () => {
    await mod.visitRequestApprove(CTX as never, { id: "vr-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.visitRequestApprove, expect.objectContaining({ type: COMMANDS.visitRequestApprove }));
  });

  it("visitRequestReject publishes correct topic", async () => {
    await mod.visitRequestReject(CTX as never, { id: "vr-1", reason: "Denied" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.visitRequestReject, expect.objectContaining({ type: COMMANDS.visitRequestReject }));
  });

  it("visitRequestCancel publishes correct topic", async () => {
    await mod.visitRequestCancel(CTX as never, { id: "vr-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.visitRequestCancel, expect.objectContaining({ type: COMMANDS.visitRequestCancel }));
  });

  it("visitRequestAutoReject publishes correct topic", async () => {
    await mod.visitRequestAutoReject(CTX as never, { id: "vr-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.visitRequestAutoReject, expect.objectContaining({ type: COMMANDS.visitRequestAutoReject }));
  });
});

// ── Digital Pass Commands ─────────────────────────────────────────────────
describe("digital-pass/commands", () => {
  let mod: typeof import("../src/modules/digital-pass/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/digital-pass/commands.js"); });

  it("passGenerate publishes correct topic", async () => {
    await mod.passGenerate(CTX as never, {
      visitRequestId: "vr-1", locationId: "loc-1", visitorName: "Jane",
      visitorPhone: "123", visitorEmail: null, hostEmployeeId: "host-1",
      passType: "single", permittedAreas: [], scheduledAt: "2025-06-15T10:00:00Z",
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.passGenerate, expect.objectContaining({ type: COMMANDS.passGenerate }));
  });

  it("passRevoke publishes correct topic", async () => {
    await mod.passRevoke(CTX as never, { passId: "p-1", reason: "lost" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.passRevoke, expect.objectContaining({ type: COMMANDS.passRevoke }));
  });

  it("passReplace publishes correct topic", async () => {
    await mod.passReplace(CTX as never, { passId: "p-1", reason: "compromised" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.passReplace, expect.objectContaining({ type: COMMANDS.passReplace }));
  });
});

// ── Check-In Commands ─────────────────────────────────────────────────────
describe("check-in/commands", () => {
  let mod: typeof import("../src/modules/check-in/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/check-in/commands.js"); });

  it("checkInRecord publishes correct topic", async () => {
    await mod.checkInRecord(CTX as never, { passId: "p-1", gateId: "g-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.checkInRecord, expect.objectContaining({ type: COMMANDS.checkInRecord }));
  });

  it("checkOutRecord publishes correct topic", async () => {
    await mod.checkOutRecord(CTX as never, { passId: "p-1", gateId: "g-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.checkOutRecord, expect.objectContaining({ type: COMMANDS.checkOutRecord }));
  });
});

// ── Blacklist Commands ────────────────────────────────────────────────────
describe("blacklist/commands", () => {
  let mod: typeof import("../src/modules/blacklist/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/blacklist/commands.js"); });

  it("blacklistAdd publishes correct topic", async () => {
    await mod.blacklistAdd(CTX as never, { personName: "Bad Actor", identityDocHash: "hash-1", reason: "incident" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.blacklistAdd, expect.objectContaining({ type: COMMANDS.blacklistAdd }));
  });

  it("blacklistApprove publishes correct topic", async () => {
    await mod.blacklistApprove(CTX as never, { id: "bl-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.blacklistApprove, expect.objectContaining({ type: COMMANDS.blacklistApprove }));
  });

  it("watchlistAdd publishes correct topic", async () => {
    await mod.watchlistAdd(CTX as never, { personName: "Risky Person", identityDocHash: "hash-2", riskLevel: "medium" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.watchlistAdd, expect.objectContaining({ type: COMMANDS.watchlistAdd }));
  });
});

// ── Device Registry Commands ──────────────────────────────────────────────
describe("device-registry/commands", () => {
  let mod: typeof import("../src/modules/device-registry/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/device-registry/commands.js"); });

  it("publishDeviceRegister publishes correct topic", async () => {
    await mod.publishDeviceRegister(CTX as never, { locationId: "loc-1", deviceType: "turnstile", name: "Gate 1", firmwareVersion: "1.0" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deviceRegister, expect.objectContaining({ type: COMMANDS.deviceRegister }));
  });

  it("publishDeviceActivate publishes correct topic", async () => {
    await mod.publishDeviceActivate(CTX as never, { id: "dev-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deviceActivate, expect.objectContaining({ type: COMMANDS.deviceActivate }));
  });

  it("publishDeviceSuspend publishes correct topic", async () => {
    await mod.publishDeviceSuspend(CTX as never, { id: "dev-1", reason: "maintenance" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deviceSuspend, expect.objectContaining({ type: COMMANDS.deviceSuspend }));
  });

  it("publishDeviceDeregister publishes correct topic", async () => {
    await mod.publishDeviceDeregister(CTX as never, { id: "dev-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deviceDeregister, expect.objectContaining({ type: COMMANDS.deviceDeregister }));
  });

  it("publishDeviceRotateCredential publishes correct topic", async () => {
    await mod.publishDeviceRotateCredential(CTX as never, { id: "dev-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deviceRotateCredential, expect.objectContaining({ type: COMMANDS.deviceRotateCredential }));
  });
});

// ── Recurring Pass Commands ───────────────────────────────────────────────
describe("recurring-pass/commands", () => {
  let mod: typeof import("../src/modules/recurring-pass/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/recurring-pass/commands.js"); });

  it("recurringPassCreate publishes correct topic", async () => {
    await mod.recurringPassCreate(CTX as never, {
      locationId: "loc-1", visitorName: "Jane", visitorPhone: "123",
      hostEmployeeId: "host-1", startDate: "2025-06-15", endDate: "2025-07-15",
      permittedDays: [1, 2, 3, 4, 5],
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.recurringPassCreate, expect.objectContaining({ type: COMMANDS.recurringPassCreate }));
  });

  it("recurringPassSuspend publishes correct topic", async () => {
    await mod.recurringPassSuspend(CTX as never, { passId: "rp-1", reason: "violation" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.recurringPassSuspend, expect.objectContaining({ type: COMMANDS.recurringPassSuspend }));
  });

  it("recurringPassRevoke publishes correct topic", async () => {
    await mod.recurringPassRevoke(CTX as never, { passId: "rp-1", reason: "terminated" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.recurringPassRevoke, expect.objectContaining({ type: COMMANDS.recurringPassRevoke }));
  });
});

// ── Group Visit Commands ──────────────────────────────────────────────────
describe("group-visit/commands", () => {
  let mod: typeof import("../src/modules/group-visit/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/group-visit/commands.js"); });

  it("groupVisitCreate publishes correct topic", async () => {
    await mod.groupVisitCreate(CTX as never, {
      locationId: "loc-1", leadVisitorName: "Lead", purpose: "Tour",
      hostEmployeeId: "host-1", scheduledAt: "2025-06-15T09:00:00Z",
      members: [{ name: "Member 1", identityDocHash: null }],
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.groupVisitCreate, expect.objectContaining({ type: COMMANDS.groupVisitCreate }));
  });

  it("groupBulkCheckIn publishes correct topic", async () => {
    await mod.groupBulkCheckIn(CTX as never, { groupVisitId: "gv-1", actualScannedCount: 5, gateId: "g-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.groupBulkCheckIn, expect.objectContaining({ type: COMMANDS.groupBulkCheckIn }));
  });
});

// ── Identity Commands ─────────────────────────────────────────────────────
describe("identity/commands", () => {
  let mod: typeof import("../src/modules/identity/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/identity/commands.js"); });

  it("digilockerVerify publishes correct topic", async () => {
    await mod.digilockerVerify(CTX as never, { visitRequestId: "vr-1", aadhaarNumber: "123456789012" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.digilockerVerify, expect.objectContaining({ type: COMMANDS.digilockerVerify }));
  });

  it("aadhaarFaceMatch publishes correct topic", async () => {
    await mod.aadhaarFaceMatch(CTX as never, { visitRequestId: "vr-1", selfieStorageKey: "s.jpg", aadhaarPhotoKey: "a.jpg" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.aadhaarFaceMatch, expect.objectContaining({ type: COMMANDS.aadhaarFaceMatch }));
  });
});

// ── Evacuation Commands ───────────────────────────────────────────────────
describe("evacuation/commands", () => {
  let mod: typeof import("../src/modules/evacuation/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/evacuation/commands.js"); });

  it("evacuationDeclare publishes correct topic", async () => {
    await mod.evacuationDeclare(CTX as never, { locationId: "loc-1", reason: "Fire", severity: "critical" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.evacuationDeclare, expect.objectContaining({ type: COMMANDS.evacuationDeclare }));
  });

  it("evacuationMarkSafe publishes correct topic", async () => {
    await mod.evacuationMarkSafe(CTX as never, { evacuationId: "ev-1", passId: "p-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.evacuationMarkSafe, expect.objectContaining({ type: COMMANDS.evacuationMarkSafe }));
  });
});

// ── Vehicle Pass Commands ─────────────────────────────────────────────────
describe("vehicle-pass/commands", () => {
  let mod: typeof import("../src/modules/vehicle-pass/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/vehicle-pass/commands.js"); });

  it("vehiclePassCreate publishes correct topic", async () => {
    await mod.vehiclePassCreate(CTX as never, {
      visitRequestId: "vr-1", vehicleNumber: "DL01AB1234",
      vehicleType: "car", parkingRequired: true,
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.vehiclePassCreate, expect.objectContaining({ type: COMMANDS.vehiclePassCreate }));
  });

  it("parkingSlotRelease publishes correct topic", async () => {
    await mod.parkingSlotRelease(CTX as never, { vehiclePassId: "vp-1" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.parkingSlotRelease, expect.objectContaining({ type: COMMANDS.parkingSlotRelease }));
  });
});

// ── Document Scan Commands ────────────────────────────────────────────────
describe("document-scan/commands", () => {
  let mod: typeof import("../src/modules/document-scan/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/document-scan/commands.js"); });

  it("publishScanProcess publishes correct topic", async () => {
    await mod.publishScanProcess(CTX as never, {
      visitRequestId: "vr-1", storageKey: "uploads/doc.jpg",
      mimeType: "image/jpeg", sizeBytes: 1024,
    } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.scanProcess, expect.objectContaining({ type: COMMANDS.scanProcess }));
  });

  it("publishScanOcrComplete publishes correct topic", async () => {
    await mod.publishScanOcrComplete(CTX as never, { scanId: "s-1", ocrResult: {} } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.scanOcrComplete, expect.objectContaining({ type: COMMANDS.scanOcrComplete }));
  });
});

// ── Config Registry Commands ──────────────────────────────────────────────
describe("config-registry/commands", () => {
  let mod: typeof import("../src/modules/config-registry/commands.js");
  beforeEach(async () => { mod = await import("../src/modules/config-registry/commands.js"); });

  it("setConfig publishes correct topic", async () => {
    await mod.setConfig(CTX as never, { namespace: "visitor_policy", configKey: "auto_approve", value: "vip" } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.setConfig, expect.objectContaining({ type: COMMANDS.setConfig }));
  });

  it("deactivateConfig publishes correct topic", async () => {
    await mod.deactivateConfig(CTX as never, "cfg-1", { expectedVersion: 1 } as never);
    expect(publishMock).toHaveBeenCalledWith(COMMANDS.deactivateConfig, expect.objectContaining({ type: COMMANDS.deactivateConfig }));
  });
});
