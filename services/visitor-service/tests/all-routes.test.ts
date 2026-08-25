/**
 * visitor-service — comprehensive route inject tests.
 *
 * Covers all 19 route modules: location, blacklist, visit-request, digital-pass,
 * check-in, identity, group-visit, recurring-pass, material-pass, vehicle-pass,
 * evacuation, vip, analytics, dpdp, device-registry, badge-print, document-scan,
 * turnstile-control, config-registry.
 *
 * Auth boundary (401/403), validation (400), not-found (404), and happy paths.
 *
 * Mocks: repo, commands, queries, domain modules to isolate route logic from DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/* ─── Constants ─── */
const FAKE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const FAKE_ID2 = "aaaaaaaa-0000-4000-8000-000000000002";
const TENANT = "11111111-aaaa-4000-8000-000000000055";
const ACTOR = "00000000-aaaa-4000-8000-000000000055";
const LOCATION_ID = "cccccccc-0000-4000-8000-000000000003";
const GATE_ID = "dddddddd-0000-4000-8000-000000000004";

const fakeAccepted = { id: FAKE_ID, status: "accepted", correlationId: "corr-1" };
const fakeLocation = { id: FAKE_ID, tenantId: TENANT, name: "HQ", address: "123 Main", version: 1 };
const fakeArea = { id: FAKE_ID2, tenantId: TENANT, locationId: FAKE_ID, name: "Block A", version: 1 };
const fakeBlacklist = { id: FAKE_ID, tenantId: TENANT, personName: "Bad Actor", reason: "theft", status: "active", version: 1 };
const fakeVisitRequest = { id: FAKE_ID, tenantId: TENANT, visitorName: "Alice", status: "pending", locationId: LOCATION_ID, version: 1 };
const fakePass = { id: FAKE_ID, tenantId: TENANT, status: "active", passType: "single", version: 1 };
const fakeConfig = { id: FAKE_ID, tenantId: TENANT, namespace: "visitor_policy", key: "max_lead_days", value: "30", active: true, version: 1 };
const fakeDevice = { id: FAKE_ID, tenantId: TENANT, deviceType: "turnstile", name: "Gate A", status: "active", online: true, lastSeenAt: new Date(), firmwareStatus: "current", firmwareVersion: "1.0", serialNumber: "SN001", locationId: LOCATION_ID, gateId: GATE_ID, capabilities: [], pendingConfig: null, configVersion: 1, version: 1, previousVersionId: null };
const fakeTemplate = { id: FAKE_ID, tenantId: TENANT, name: "VIP Badge", printerLanguage: "zpl", templateBody: "^XA^XZ", badgeWidthMm: 85, badgeHeightMm: 54, visitorCategory: "vip", status: "active", version: 1, previousVersionId: FAKE_ID2 };
const fakeScanSession = { id: FAKE_ID, tenantId: TENANT, deviceId: FAKE_ID2, status: "completed", imageStorageKey: "scans/x", imageDeleted: false, createdAt: new Date() };
const fakeMaterialPass = [{ id: FAKE_ID, passId: FAKE_ID, description: "Laptop", quantity: 1, serialNumber: "SN1" }];

/* ─── Mock location repo & commands ─── */
vi.mock("../src/modules/location/repo.js", () => ({
  listLocations: vi.fn(async () => [fakeLocation]),
  getLocationById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeLocation : null)),
  listAreas: vi.fn(async () => [fakeArea]),
  listParkingSlots: vi.fn(async () => []),
}));
vi.mock("../src/modules/location/commands.js", () => ({
  locationCreate: vi.fn(async () => fakeAccepted),
  areaCreate: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock blacklist repo & commands ─── */
vi.mock("../src/modules/blacklist/repo.js", () => ({
  listBlacklistEntries: vi.fn(async () => [fakeBlacklist]),
  getBlacklistEntryById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeBlacklist : null)),
  listWatchlistEntries: vi.fn(async () => []),
  fuzzyScreenName: vi.fn(async () => []),
}));
vi.mock("../src/modules/blacklist/commands.js", () => ({
  blacklistAdd: vi.fn(async () => fakeAccepted),
  blacklistApprove: vi.fn(async () => fakeAccepted),
  watchlistAdd: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/blacklist/screening-store.js", () => ({
  isBlacklisted: vi.fn(async () => false),
}));
vi.mock("../src/modules/blacklist/blind-index.js", () => ({
  identityDocHash: vi.fn(() => "hash123"),
}));

/* ─── Mock visit-request repo & commands ─── */
vi.mock("../src/modules/visit-request/repo.js", () => ({
  listVisitRequests: vi.fn(async () => [fakeVisitRequest]),
  getVisitRequestById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeVisitRequest : null)),
}));
vi.mock("../src/modules/visit-request/commands.js", () => ({
  visitRequestCreate: vi.fn(async () => fakeAccepted),
  visitRequestApprove: vi.fn(async () => fakeAccepted),
  visitRequestReject: vi.fn(async () => fakeAccepted),
  visitRequestCancel: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/visit-request/domain.js", () => ({
  assertValidScheduledDate: vi.fn(),
}));

/* ─── Mock config-registry policy (used by visit-request) ─── */
vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyNumber: vi.fn(async () => 1),
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: 86400000,
}));

/* ─── Mock DPDP consent (used by visit-request) ─── */
vi.mock("../src/modules/dpdp/consent.js", () => ({
  logConsent: vi.fn(async () => undefined),
}));

/* ─── Mock digital-pass repo & commands ─── */
vi.mock("../src/modules/digital-pass/repo.js", () => ({
  getPassById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakePass : null)),
}));
vi.mock("../src/modules/digital-pass/commands.js", () => ({
  passRevoke: vi.fn(async () => fakeAccepted),
  passReplace: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/digital-pass/revocation-store.js", () => ({
  isRevoked: vi.fn(async () => false),
}));

/* ─── Mock check-in repo & commands ─── */
vi.mock("../src/modules/check-in/repo.js", () => ({
  listActiveVisitors: vi.fn(async () => []),
}));
vi.mock("../src/modules/check-in/commands.js", () => ({
  checkInRecord: vi.fn(async () => fakeAccepted),
  checkOutRecord: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/check-in/gate-sync.js", () => ({
  loadGateSyncSnapshot: vi.fn(async () => ({ revokedPassIds: [], blacklistHashes: [], watchlistHashes: [] })),
}));

/* ─── Mock identity commands ─── */
vi.mock("../src/modules/identity/commands.js", () => ({
  digilockerVerify: vi.fn(async () => fakeAccepted),
  aadhaarFaceMatch: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock group-visit commands ─── */
vi.mock("../src/modules/group-visit/commands.js", () => ({
  groupVisitCreate: vi.fn(async () => fakeAccepted),
  groupBulkCheckIn: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock recurring-pass commands ─── */
vi.mock("../src/modules/recurring-pass/commands.js", () => ({
  recurringPassCreate: vi.fn(async () => fakeAccepted),
  recurringPassSuspend: vi.fn(async () => fakeAccepted),
  recurringPassRevoke: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock material-pass repo & commands ─── */
vi.mock("../src/modules/material-pass/repo.js", () => ({
  getMaterialPassesByPassId: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeMaterialPass : [])),
}));
vi.mock("../src/modules/material-pass/commands.js", () => ({
  materialPassCreate: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock vehicle-pass commands ─── */
vi.mock("../src/modules/vehicle-pass/commands.js", () => ({
  vehiclePassCreate: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock evacuation commands & roster ─── */
vi.mock("../src/modules/evacuation/commands.js", () => ({
  evacuationDeclare: vi.fn(async () => fakeAccepted),
  evacuationMarkSafe: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/evacuation/roster.js", () => ({
  getFullRoster: vi.fn(async () => []),
  getVisitorCount: vi.fn(async () => 5),
}));

/* ─── Mock VIP domain ─── */
vi.mock("../src/modules/vip/domain.js", () => ({
  assertCanViewVipLog: vi.fn((roles: string[]) => {
    if (!roles.includes("protocol_officer") && !roles.includes("security_admin") && !roles.includes("tenant_admin") && !roles.includes("super_admin"))
      throw new Error("FORBIDDEN");
  }),
}));

/* ─── Mock analytics ─── */
vi.mock("../src/modules/analytics/domain.js", () => ({
  computeTrends: vi.fn(() => []),
}));

/* ─── Mock config-registry repo, commands, presets, domain ─── */
vi.mock("../src/modules/config-registry/repo.js", () => ({
  listByNamespace: vi.fn(async () => [fakeConfig]),
  getConfig: vi.fn(async (_tid: string, ns: string, key: string) => (key === "max_lead_days" ? fakeConfig : null)),
}));
vi.mock("../src/modules/config-registry/commands.js", () => ({
  setConfig: vi.fn(async () => fakeAccepted),
  deactivateConfig: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/config-registry/presets.js", () => ({
  applyPreset: vi.fn(async () => ({ applied: 5, skipped: 0 })),
}));
vi.mock("../src/modules/config-registry/domain.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    assertValidNamespace: vi.fn(),
    assertValidKey: vi.fn(),
  };
});

/* ─── Mock device-registry repo & commands ─── */
vi.mock("../src/modules/device-registry/repo.js", () => ({
  getDeviceById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeDevice : null)),
  getDeviceBoundToGate: vi.fn(async () => null),
  listDevices: vi.fn(async () => ({ data: [fakeDevice], meta: { page: 1, pageSize: 20, total: 1 } })),
  toPublicDevice: vi.fn((d: any) => d),
  getAllLocationHealthSummaries: vi.fn(async () => []),
  getLocationHealthSummary: vi.fn(async (_tid: string, locId: string) => (locId === LOCATION_ID ? { total: 1, online: 1, offline: 0 } : null)),
  getFirmwareInventory: vi.fn(async () => []),
  getDeviceAuditLog: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 20, total: 0 } })),
}));
vi.mock("../src/modules/device-registry/commands.js", () => ({
  publishDeviceRegister: vi.fn(async () => fakeAccepted),
  publishDeviceActivate: vi.fn(async () => fakeAccepted),
  publishDeviceSuspend: vi.fn(async () => fakeAccepted),
  publishDeviceDeregister: vi.fn(async () => fakeAccepted),
  publishDeviceRotateCredential: vi.fn(async () => fakeAccepted),
  publishDeviceConfigPush: vi.fn(async () => fakeAccepted),
  publishDeviceBulkConfigPush: vi.fn(async () => fakeAccepted),
  publishDeviceFirmwareSchedule: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/device-registry/device-auth.js", () => ({
  deviceAuth: vi.fn(async (req: any, _reply: any) => {
    // Skip device auth for non-device endpoints — allow through. gateId matches
    // GATE_ID (Fix 5: turnstile-control/routes.ts now rejects a passage/
    // tailgating body.gateId that does not match deviceContext.gateId).
    req.deviceContext = { tenantId: TENANT, deviceId: FAKE_ID, gateId: GATE_ID };
  }),
}));

/* ─── Mock badge-print repo & commands ─── */
vi.mock("../src/modules/badge-print/repo.js", () => ({
  getTemplateById: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeTemplate : null)),
  listTemplates: vi.fn(async () => ({ data: [fakeTemplate], meta: { page: 1, pageSize: 20, total: 1 } })),
  getNextJobForDevice: vi.fn(async () => null),
  listPrintJobs: vi.fn(async () => ({ data: [], meta: { page: 1, pageSize: 20, total: 0 } })),
  getTemplateVersionChain: vi.fn(async () => []),
}));
vi.mock("../src/modules/badge-print/commands.js", () => ({
  publishBadgeTemplateCreate: vi.fn(async () => fakeAccepted),
  publishBadgeTemplateUpdate: vi.fn(async () => fakeAccepted),
  publishPrintJobAcknowledge: vi.fn(async () => fakeAccepted),
  publishPrintJobFail: vi.fn(async () => fakeAccepted),
  publishPrintJobRequeue: vi.fn(async () => fakeAccepted),
  publishPrintJobCreate: vi.fn(async () => fakeAccepted),
}));

/* ─── Mock document-scan repo & commands ─── */
vi.mock("../src/modules/document-scan/repo.js", () => ({
  getScanSession: vi.fn(async (_tid: string, id: string) => (id === FAKE_ID ? fakeScanSession : null)),
  getOcrResult: vi.fn(async () => ({ text: "SCAN RESULT" })),
  listScans: vi.fn(async () => ({ data: [fakeScanSession], meta: { page: 1, pageSize: 20, total: 1 } })),
}));
vi.mock("../src/modules/document-scan/commands.js", () => ({
  publishScanProcess: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/document-scan/domain.js", () => ({
  validateImage: vi.fn(() => ({ valid: true })),
}));

/* ─── Mock turnstile-control repo & commands ─── */
vi.mock("../src/modules/turnstile-control/repo.js", () => ({
  clearAntiPassbackState: vi.fn(async () => undefined),
  updateCommandStatus: vi.fn(async () => undefined),
  getCommandCountForDevice: vi.fn(async () => 0),
}));
vi.mock("../src/modules/turnstile-control/commands.js", () => ({
  publishPassageRecord: vi.fn(async () => fakeAccepted),
  publishEmergencyUnlock: vi.fn(async () => fakeAccepted),
  publishEmergencyRestore: vi.fn(async () => fakeAccepted),
  publishOfflineSync: vi.fn(async () => fakeAccepted),
}));
vi.mock("../src/modules/turnstile-control/command-queue.js", () => ({
  dequeueCommand: vi.fn(async () => null),
}));

/* ─── Mock shared modules ─── */
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: any) => fn({ select: () => ({ from: () => ({ where: () => ({ limit: () => [{ id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: FAKE_ID2 }] }) }) }), update: () => ({ set: () => ({ where: () => ({ returning: () => [] }) }) }), insert: () => ({ values: () => undefined }) })) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async (fn: any) => fn({ select: () => ({ from: () => ({ where: () => [] }) }) })),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(async (_k: string, fn: any) => fn()), put: vi.fn(async () => undefined), makeKey: vi.fn((...args: string[]) => args.join(":")) },
  queue: { publish: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
}));
vi.mock("../src/shared/qr-crypto.js", () => ({
  verifyPassQr: vi.fn(async () => ({ visit_id: FAKE_ID, visitor_id: ACTOR, location_id: LOCATION_ID, pass_type: "single", pass_number: "P001", permitted_areas: [], valid_from: "2025-01-01", valid_until: "2025-12-31" })),
}));
vi.mock("../src/shared/pii-crypto.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    assertPiiKeyConfigured: vi.fn(),
  };
});
vi.mock("@civitasone/events", () => ({
  NOTIFICATION_SEND: "notification.send",
  buildNotificationPayload: vi.fn((p: any) => p),
}));
vi.mock("@civitasone/db", () => ({
  createTenantTxHook: vi.fn(() => async () => {}),
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn(async (_tid: string, fn: any) => fn()),
}));
vi.mock("@civitasone/outbox", () => ({}));

/* ─── Auth helpers ─── */
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
function headers(roles?: string[], tid?: string, sub?: string) {
  return { authorization: `Bearer ${token(roles, tid, sub)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  process.env.EVACUATION_ALLOWED_IPS = "127.0.0.1";
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });


// ══════════════════════════════════════════════════════════════════════════════
// 1. LOCATION ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Location routes — auth", () => {
  it("GET /v1/visitor/locations → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/locations" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/locations → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/locations", headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/locations → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/locations", payload: { name: "x", address: "y" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/locations → 403 employee role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/locations", headers: headers(["employee"]), payload: { name: "x", address: "y" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Location routes — validation", () => {
  it("GET /v1/visitor/locations/:id/areas non-uuid → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/locations/bad/areas", headers: headers() });
    expect(res.statusCode).toBe(400);
  });
  it("POST /v1/visitor/locations/:id/areas non-uuid → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/locations/bad/areas", headers: headers(), payload: { name: "Area 1" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Location routes — 404", () => {
  it("GET /v1/visitor/locations/:id/areas unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/locations/99999999-9999-4000-8000-999999999999/areas`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/visitor/locations/:id/areas unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/locations/99999999-9999-4000-8000-999999999999/areas`, headers: headers(), payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
  });
  it("GET /v1/visitor/locations/:id/parking unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/locations/99999999-9999-4000-8000-999999999999/parking`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
});

describe("Location routes — happy paths", () => {
  it("GET /v1/visitor/locations → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/locations", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("POST /v1/visitor/locations → 202", async () => {
    // Task Q-95.1: location create moved onto the queue-first CQRS convention (201 → 202).
    const res = await app.inject({ method: "POST", url: "/v1/visitor/locations", headers: headers(), payload: { name: "New HQ", address: "456 Elm" } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/locations/:id/areas → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/locations/${FAKE_ID}/areas`, headers: headers() });
    expect(res.statusCode).toBe(200);
  });
  it("POST /v1/visitor/locations/:id/areas → 202", async () => {
    // Task Q-95.1: area create moved onto the queue-first CQRS convention (201 → 202).
    const res = await app.inject({ method: "POST", url: `/v1/visitor/locations/${FAKE_ID}/areas`, headers: headers(), payload: { name: "Block B" } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/locations/:id/parking → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/locations/${FAKE_ID}/parking`, headers: headers() });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. BLACKLIST ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Blacklist routes — auth", () => {
  it("GET /v1/visitor/blacklist → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/blacklist" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/blacklist → 403 employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/blacklist", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/blacklist → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/blacklist", payload: { personName: "X", reason: "theft" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/blacklist → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/blacklist", headers: headers(["employee"]), payload: { personName: "X", reason: "theft" } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/blacklist/:id/approve → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/blacklist/${FAKE_ID}/approve` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Blacklist routes — 404", () => {
  it("POST /v1/visitor/blacklist/:id/approve unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/blacklist/99999999-9999-4000-8000-999999999999/approve`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
});

describe("Blacklist routes — happy paths", () => {
  it("GET /v1/visitor/blacklist → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/blacklist", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("POST /v1/visitor/blacklist → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/blacklist", headers: headers(), payload: { personName: "Bad Guy", reason: "violence" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/blacklist/:id/approve → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/blacklist/${FAKE_ID}/approve`, headers: headers() });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/watchlist → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/watchlist", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
  });
  it("POST /v1/visitor/watchlist → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/watchlist", headers: headers(), payload: { personName: "Suspicious" } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. VISIT-REQUEST ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Visit-request routes — auth", () => {
  it("POST /v1/visitor/visit-requests → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/visit-requests", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/visit-requests → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/visit-requests" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/visit-requests/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/visit-requests/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Visit-request routes — validation", () => {
  it("GET /v1/visitor/visit-requests/:id non-uuid → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/visit-requests/bad-id", headers: headers() });
    expect(res.statusCode).toBe(400);
  });
});

describe("Visit-request routes — 404", () => {
  it("GET /v1/visitor/visit-requests/:id unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/visit-requests/99999999-9999-4000-8000-999999999999`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/visitor/visit-requests/:id/approve unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/99999999-9999-4000-8000-999999999999/approve`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/visitor/visit-requests/:id/reject unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/99999999-9999-4000-8000-999999999999/reject`, headers: headers(), payload: { reason: "denied" } });
    expect(res.statusCode).toBe(404);
  });
  it("DELETE /v1/visitor/visit-requests/:id unknown → 404", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/visitor/visit-requests/99999999-9999-4000-8000-999999999999`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
});

describe("Visit-request routes — happy paths", () => {
  it("POST /v1/visitor/visit-requests → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/visitor/visit-requests", headers: headers(["employee"]),
      payload: { locationId: LOCATION_ID, visitorName: "Alice", visitorPhone: "+91-9999", purpose: "meeting", hostEmployeeId: ACTOR, scheduledAt: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/visit-requests → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/visit-requests", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/visit-requests/:id → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/visit-requests/${FAKE_ID}`, headers: headers() });
    expect(res.statusCode).toBe(200);
  });
  it("POST /v1/visitor/visit-requests/:id/approve → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/approve`, headers: headers() });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/visit-requests/:id/reject → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/reject`, headers: headers(), payload: { reason: "not approved" } });
    expect(res.statusCode).toBe(202);
  });
  it("DELETE /v1/visitor/visit-requests/:id → 202", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/visitor/visit-requests/${FAKE_ID}`, headers: headers() });
    expect(res.statusCode).toBe(202);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 4. DIGITAL-PASS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Digital-pass routes — auth", () => {
  it("GET /v1/visitor/passes/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/passes/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/passes/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/passes/${FAKE_ID}`, headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/passes/:id/revoke → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/${FAKE_ID}/revoke`, payload: { reason: "lost" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/passes/:id/revoke → 403 employee role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/${FAKE_ID}/revoke`, headers: headers(["employee"]), payload: { reason: "lost" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Digital-pass routes — validation", () => {
  it("GET /v1/visitor/passes/:id non-uuid → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/passes/bad", headers: headers() });
    expect(res.statusCode).toBe(400);
  });
});

describe("Digital-pass routes — 404", () => {
  it("GET /v1/visitor/passes/:id unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/passes/99999999-9999-4000-8000-999999999999`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/visitor/passes/:id/revoke unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/99999999-9999-4000-8000-999999999999/revoke`, headers: headers(), payload: { reason: "lost" } });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/visitor/passes/:id/replace unknown → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/99999999-9999-4000-8000-999999999999/replace`, headers: headers(), payload: { reason: "damaged", tenantPrivateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("Digital-pass routes — happy paths", () => {
  it("GET /v1/visitor/passes/:id → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/passes/${FAKE_ID}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("POST /v1/visitor/passes/:id/revoke → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/${FAKE_ID}/revoke`, headers: headers(), payload: { reason: "lost" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/passes/:id/replace → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/passes/${FAKE_ID}/replace`, headers: headers(), payload: { reason: "damaged", tenantPrivateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----" } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CHECK-IN ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Check-in routes — auth", () => {
  it("GET /v1/visitor/check-ins/active → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/check-ins/active" });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/check-ins → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/check-outs → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-outs", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe("Check-in routes — happy paths", () => {
  it("GET /v1/visitor/check-ins/active → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/check-ins/active", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("POST /v1/visitor/check-ins → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", headers: headers(["security_admin"]), payload: { passId: FAKE_ID, gateId: GATE_ID } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/check-outs → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-outs", headers: headers(["security_admin"]), payload: { passId: FAKE_ID, gateId: GATE_ID } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. IDENTITY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Identity routes — auth", () => {
  it("POST /v1/visitor/visit-requests/:id/verify-identity → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/verify-identity`, payload: { identityMethod: "digilocker", digilockerUri: "uri123" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/visit-requests/:id/verify-identity → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/verify-identity`, headers: headers(["employee"]), payload: { identityMethod: "digilocker", digilockerUri: "uri123" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Identity routes — validation", () => {
  it("POST verify-identity non-uuid param → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/visit-requests/not-uuid/verify-identity", headers: headers(["security_admin"]), payload: { identityMethod: "digilocker", digilockerUri: "uri" } });
    expect(res.statusCode).toBe(400);
  });
  it("POST verify-identity invalid discriminator → 400", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/verify-identity`, headers: headers(["security_admin"]), payload: { identityMethod: "unknown", data: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Identity routes — happy paths", () => {
  it("POST verify-identity digilocker → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/verify-identity`, headers: headers(["security_admin"]), payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST verify-identity aadhaar_face → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/visit-requests/${FAKE_ID}/verify-identity`, headers: headers(["security_admin"]), payload: { identityMethod: "aadhaar_face", aadhaarRef: "ref123", livePhotoBase64: "base64data" } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GROUP-VISIT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Group-visit routes — auth", () => {
  it("POST /v1/visitor/group-visits → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/group-visits", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/group-visits → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/group-visits", headers: headers(["employee"]), payload: { groupName: "x", purpose: "y", locationId: LOCATION_ID, hostEmployeeId: ACTOR, leadVisitorName: "z", leadVisitorPhone: "+91", members: [{ name: "m1" }] } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/group-visits/:id/bulk-checkin → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/group-visits/${FAKE_ID}/bulk-checkin`, payload: { actualHeadcount: 5 } });
    expect(res.statusCode).toBe(401);
  });
});

describe("Group-visit routes — validation", () => {
  it("POST /v1/visitor/group-visits/:id/bulk-checkin non-uuid → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/group-visits/bad/bulk-checkin", headers: headers(["receptionist"]), payload: { actualHeadcount: 5 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Group-visit routes — happy paths", () => {
  it("POST /v1/visitor/group-visits → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/group-visits", headers: headers(["receptionist"]), payload: { groupName: "School Trip", purpose: "tour", locationId: LOCATION_ID, hostEmployeeId: ACTOR, leadVisitorName: "Teacher", leadVisitorPhone: "+911234", members: [{ name: "Student 1" }, { name: "Student 2" }] } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/group-visits/:id/bulk-checkin → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/group-visits/${FAKE_ID}/bulk-checkin`, headers: headers(["receptionist"]), payload: { actualHeadcount: 10 } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. RECURRING-PASS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Recurring-pass routes — auth", () => {
  it("POST /v1/visitor/recurring-passes → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/recurring-passes", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/recurring-passes → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/recurring-passes", headers: headers(["employee"]), payload: { locationId: LOCATION_ID, visitorName: "x", visitorPhone: "+91", validFrom: "2025-01-01", validUntil: "2025-03-01", permittedDays: ["monday"] } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/recurring-passes/:id/suspend → 401", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/recurring-passes/${FAKE_ID}/suspend`, payload: { reason: "x" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("Recurring-pass routes — happy paths", () => {
  it("POST /v1/visitor/recurring-passes → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/recurring-passes", headers: headers(["receptionist"]), payload: { locationId: LOCATION_ID, visitorName: "Vendor Bob", visitorPhone: "+919999", validFrom: "2025-01-01T00:00:00Z", validUntil: "2025-03-01T00:00:00Z", permittedDays: [1, 3] } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/recurring-passes/:id/suspend → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/recurring-passes/${FAKE_ID}/suspend`, headers: headers(), payload: { reason: "security concern" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/recurring-passes/:id/revoke → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/recurring-passes/${FAKE_ID}/revoke`, headers: headers(), payload: { reason: "terminated" } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. MATERIAL-PASS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Material-pass routes — auth", () => {
  it("POST /v1/visitor/material-passes → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/material-passes", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/material-passes → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/material-passes", headers: headers(["employee"]), payload: { passId: FAKE_ID, locationId: LOCATION_ID, items: [{ description: "Laptop", quantity: 1 }] } });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/material-passes/:passId → 401", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/material-passes/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Material-pass routes — 404", () => {
  it("GET /v1/visitor/material-passes/:passId unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/material-passes/99999999-9999-4000-8000-999999999999`, headers: headers() });
    expect(res.statusCode).toBe(404);
  });
});

describe("Material-pass routes — happy paths", () => {
  it("POST /v1/visitor/material-passes → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/material-passes", headers: headers(["security_admin"]), payload: { passId: FAKE_ID, locationId: LOCATION_ID, items: [{ description: "Laptop", quantity: 1, serialNumber: "SN1" }] } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/material-passes/:passId → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/material-passes/${FAKE_ID}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. VEHICLE-PASS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Vehicle-pass routes — auth", () => {
  it("POST /v1/visitor/vehicle-passes → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/vehicle-passes", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/vehicle-passes → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/vehicle-passes", headers: headers(["citizen"]), payload: { passId: FAKE_ID, locationId: LOCATION_ID, registrationNumber: "MH01AB1234", vehicleType: "car", visitorCategory: "general" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Vehicle-pass routes — happy paths", () => {
  it("POST /v1/visitor/vehicle-passes → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/vehicle-passes", headers: headers(["security_admin"]), payload: { passId: FAKE_ID, locationId: LOCATION_ID, registrationNumber: "MH01AB1234", vehicleType: "car", visitorCategory: "standard" } });
    expect(res.statusCode).toBe(202);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 11. EVACUATION ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Evacuation routes — auth", () => {
  it("GET /v1/visitor/evacuation/roster → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/evacuation/roster?locationId=" + LOCATION_ID });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/evacuation/count → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/evacuation/count?locationId=" + LOCATION_ID });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/evacuation/declare → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/evacuation/declare", payload: { locationId: LOCATION_ID } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/evacuation/declare → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/evacuation/declare", headers: headers(["employee"]), payload: { locationId: LOCATION_ID } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/evacuation/mark-safe → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/evacuation/mark-safe", payload: { locationId: LOCATION_ID, passId: FAKE_ID } });
    expect(res.statusCode).toBe(401);
  });
});

describe("Evacuation routes — happy paths", () => {
  it("GET /v1/visitor/evacuation/roster → 200 with allowed IP", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/evacuation/roster?locationId=${LOCATION_ID}`, headers: { ...headers(["security_admin"]), "x-forwarded-for": "127.0.0.1" } });
    expect(res.statusCode).toBe(200);
  });
  it("GET /v1/visitor/evacuation/count → 200 with allowed IP", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/evacuation/count?locationId=${LOCATION_ID}`, headers: { ...headers(["security_admin"]), "x-forwarded-for": "127.0.0.1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBeDefined();
  });
  it("POST /v1/visitor/evacuation/declare → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/evacuation/declare", headers: headers(["security_admin"]), payload: { locationId: LOCATION_ID, reason: "fire drill" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/evacuation/mark-safe → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/evacuation/mark-safe", headers: headers(["security_admin"]), payload: { locationId: LOCATION_ID, passId: FAKE_ID } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. VIP ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("VIP routes — auth", () => {
  it("GET /v1/visitor/vip/log → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/vip/log" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/vip/log → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/vip/log", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("VIP routes — happy paths", () => {
  it("GET /v1/visitor/vip/log → 200 with protocol_officer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/vip/log", headers: headers(["protocol_officer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/vip/log → 200 with security_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/vip/log", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. ANALYTICS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Analytics routes — auth", () => {
  it("GET /v1/visitor/analytics/daily → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/daily?date=2025-01-01" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/analytics/daily → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/daily?date=2025-01-01", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/analytics/trends → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/trends?dateFrom=2025-01-01&dateTo=2025-01-31&period=weekly" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/analytics/export → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/export?dateFrom=2025-01-01&dateTo=2025-01-31" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Analytics routes — happy paths", () => {
  it("GET /v1/visitor/analytics/daily → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/daily?date=2025-01-01", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/analytics/trends → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/trends?dateFrom=2025-01-01&dateTo=2025-01-31&period=weekly", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
  });
  it("GET /v1/visitor/analytics/export → 200 CSV", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/export?dateFrom=2025-01-01&dateTo=2025-01-31", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. DPDP ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("DPDP routes — auth", () => {
  it("POST /v1/visitor/dpdp/erasure-requests → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/dpdp/erasure-requests", payload: { visitorPhone: "+91" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/dpdp/erasure-requests → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/dpdp/erasure-requests", headers: headers(["employee"]), payload: { visitorPhone: "+91" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("DPDP routes — validation", () => {
  it("POST erasure with neither ref nor phone → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/dpdp/erasure-requests", headers: headers(["dpo"]), payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe("DPDP routes — happy paths", () => {
  it("POST /v1/visitor/dpdp/erasure-requests → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/dpdp/erasure-requests", headers: headers(["dpo"]), payload: { visitorPhone: "+919876543210" } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.erasureId).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. CONFIG-REGISTRY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Config-registry routes — auth", () => {
  it("POST /v1/visitor/config → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/config", payload: { namespace: "visitor_policy", key: "k", value: "v" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/config → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/config", headers: headers(["employee"]), payload: { namespace: "visitor_policy", key: "k", value: "v" } });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/config/:namespace → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config/visitor_policy" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/config/:namespace → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config/visitor_policy", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("Config-registry routes — 404", () => {
  it("GET /v1/visitor/config-entry unknown key → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config-entry?namespace=visitor_policy&key=nonexistent", headers: headers() });
    expect(res.statusCode).toBe(404);
  });
});

describe("Config-registry routes — happy paths", () => {
  it("POST /v1/visitor/config → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/config", headers: headers(), payload: { namespace: "visitor_policy", configKey: "max_lead_days", value: "30" } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/config/:namespace → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config/visitor_policy", headers: headers(["security_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toBeDefined();
  });
  it("GET /v1/visitor/config-entry → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config-entry?namespace=visitor_policy&key=max_lead_days", headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().item).toBeDefined();
  });
  it("POST /v1/visitor/config/presets/:preset → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/config/presets/secretariat", headers: headers() });
    expect(res.statusCode).toBe(202);
  });
  it("PATCH /v1/visitor/config/:id/deactivate → 202", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/visitor/config/${FAKE_ID}/deactivate`, headers: headers(), payload: { expectedVersion: 1 } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. DEVICE-REGISTRY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Device-registry routes — auth", () => {
  it("POST /v1/visitor/devices → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/devices", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/devices → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/devices", headers: headers(["employee"]), payload: { deviceType: "turnstile", name: "Gate A", serialNumber: "SN001", locationId: LOCATION_ID, capabilities: [] } });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/devices → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/devices" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/devices/:deviceId → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/devices/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Device-registry routes — 404", () => {
  it("GET /v1/visitor/devices/:deviceId unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/devices/99999999-9999-4000-8000-999999999999`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Device-registry routes — happy paths", () => {
  it("POST /v1/visitor/devices → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/devices", headers: headers(["facility_admin"]), payload: { deviceType: "turnstile", name: "Gate B", serialNumber: "SN002", locationId: LOCATION_ID, capabilities: { qr: ["scan"] } } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/devices → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/devices", headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/devices/:deviceId → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/devices/${FAKE_ID}`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
  });
  it("PATCH /v1/visitor/devices/:deviceId → 202", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/visitor/devices/${FAKE_ID}`, headers: headers(["facility_admin"]), payload: { name: "Updated Gate" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/devices/:deviceId/activate → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/devices/${FAKE_ID}/activate`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/devices/:deviceId/suspend → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/devices/${FAKE_ID}/suspend`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/devices/:deviceId/deregister → 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/visitor/devices/${FAKE_ID}/deregister`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(202);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 17. BADGE-PRINT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Badge-print routes — auth", () => {
  it("POST /v1/visitor/badges/templates → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/badges/templates", payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/badges/templates → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/badges/templates", headers: headers(["employee"]), payload: { name: "x", printerLanguage: "zpl", templateBody: "^XA^XZ", badgeWidthMm: 85, badgeHeightMm: 54, visitorCategory: "general" } });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/badges/templates → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/badges/templates" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/badges/templates/:templateId → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/badges/templates/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Badge-print routes — validation", () => {
  it("GET /v1/visitor/badges/templates/:templateId non-uuid → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/badges/templates/bad", headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(400);
  });
});

describe("Badge-print routes — 404", () => {
  it("GET /v1/visitor/badges/templates/:templateId unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/badges/templates/99999999-9999-4000-8000-999999999999`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Badge-print routes — happy paths", () => {
  it("POST /v1/visitor/badges/templates → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/badges/templates", headers: headers(["facility_admin"]), payload: { name: "VIP Template", printerLanguage: "zpl", templateBody: "^XA^XZ", badgeWidthMm: 85, badgeHeightMm: 54, visitorCategory: "vip" } });
    expect(res.statusCode).toBe(202);
  });
  it("GET /v1/visitor/badges/templates → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/badges/templates", headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/badges/templates/:templateId → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/badges/templates/${FAKE_ID}`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
  });
  it("PATCH /v1/visitor/badges/templates/:templateId → 202", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/visitor/badges/templates/${FAKE_ID}`, headers: headers(["facility_admin"]), payload: { name: "Updated Template" } });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. DOCUMENT-SCAN ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Document-scan routes — auth", () => {
  it("GET /v1/visitor/scans → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/scans" });
    expect(res.statusCode).toBe(401);
  });
  it("GET /v1/visitor/scans → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/scans", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
  it("GET /v1/visitor/scans/:sessionId → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/scans/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Document-scan routes — 404", () => {
  it("GET /v1/visitor/scans/:sessionId unknown → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/scans/99999999-9999-4000-8000-999999999999`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Document-scan routes — happy paths", () => {
  it("GET /v1/visitor/scans → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/scans", headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
  it("GET /v1/visitor/scans/:sessionId → 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/scans/${FAKE_ID}`, headers: headers(["facility_admin"]) });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. TURNSTILE-CONTROL ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Turnstile-control routes — auth", () => {
  it("POST /v1/visitor/turnstiles/emergency-unlock → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/emergency-unlock", payload: { locationId: LOCATION_ID, reason: "fire" } });
    expect(res.statusCode).toBe(401);
  });
  it("POST /v1/visitor/turnstiles/emergency-unlock → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/emergency-unlock", headers: headers(["employee"]), payload: { locationId: LOCATION_ID, reason: "fire" } });
    expect(res.statusCode).toBe(403);
  });
  it("POST /v1/visitor/turnstiles/emergency-restore → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/emergency-restore", payload: { locationId: LOCATION_ID } });
    expect(res.statusCode).toBe(401);
  });
});

describe("Turnstile-control routes — happy paths", () => {
  it("POST /v1/visitor/turnstiles/emergency-unlock → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/emergency-unlock", headers: headers(["security_admin"]), payload: { locationId: LOCATION_ID, reason: "fire alarm" } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/turnstiles/emergency-restore → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/emergency-restore", headers: headers(["security_admin"]), payload: { locationId: LOCATION_ID } });
    expect(res.statusCode).toBe(202);
  });
  it("POST /v1/visitor/turnstiles/passage (device auth) → 202", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/turnstiles/passage", payload: { passId: FAKE_ID, gateId: GATE_ID, direction: "in", passageCount: 1, eventTimestamp: new Date().toISOString(), offlineRecorded: false } });
    expect(res.statusCode).toBe(202);
  });
});
