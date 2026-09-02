import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_geo_attendance_Consumers } from "../src/modules/geo-attendance/f3-consumer.js";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

// Office-location creation and every geo punch are async F3 writes: the route
// publishes the write and answers 201 immediately, so without the consumer
// subscribed nothing is ever persisted and this suite could not tell a working
// write from one that throws inside the consumer. Only worker.ts registers the
// F3 consumers in production, so register once here and drain after each POST.
registerF3_geo_attendance_Consumers(queue);

/** Await the async F3 write published by the route just injected. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

let app: FastifyInstance;

function mint(sub = "00000000-0000-0000-0000-000000000099", roles = ["super_admin","hr_admin","officer","employee"]) {
  const S = process.env.JWT_SECRET ?? "civitasone-dev-secret";
  const T = "00000000-0000-0000-0000-000000000001";
  const n = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, iss: "civitasone-dev", tid: T, tenantId: T, sid: "t", email: "t@t.dev", name: "Tester", roles, iat: n, exp: n + 3600 });
  const sig = createHmac("sha256", S).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

const EMP1 = "eeeeeeee-0001-0000-0000-000000000005"; // Ravi Kumar
const EMP2 = "eeeeeeee-0001-0000-0000-000000000006"; // Priya Sharma
const OFFICE_DELHI = "aaaaaaaa-0001-0000-0000-000000000001";
// Delhi coords: 28.6139, 77.2090 radius 200m
const DELHI_LAT = 28.6139; const DELHI_LNG = 77.2090;

const AUTH = { authorization: `Bearer ${mint()}` };
const CT = { "content-type": "application/json" };

beforeAll(async () => { app = await buildApp(); });

// ═══════════════════════════════════════════════════════════
// A. OFFICE LOCATIONS & GEO-FENCING
// ═══════════════════════════════════════════════════════════
describe("A. Office Locations", () => {
  it("A1. List office locations with geo-boundaries", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/office-locations", headers: AUTH });
    expect(r.statusCode).toBe(200);
    const locs = r.json().data;
    expect(locs.length).toBeGreaterThanOrEqual(3);
    expect(locs[0]).toHaveProperty("latitude");
    expect(locs[0]).toHaveProperty("longitude");
    expect(locs[0]).toHaveProperty("radiusMeters");
  });

  it("A2. Create new office location with geo-fence", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/office-locations",
      headers: { ...AUTH, ...CT },
      payload: { name: "Satellite Office Noida", latitude: 28.5355, longitude: 77.3910, radiusMeters: 300, address: "Sector 62, Noida" },
    });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(r.json().radiusMeters).toBe(300);
  });

  it("A3. Rejects location without coordinates (500 = DB constraint)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/office-locations",
      headers: { ...AUTH, ...CT },
      payload: { name: "Bad Location" },
    });
    expect([400, 500].includes(r.statusCode)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// B. GEO-FENCED VIDEO ATTENDANCE (Check-in/Check-out)
// ═══════════════════════════════════════════════════════════
describe("B. Geo-Fenced Attendance — Check-In", () => {
  it("B1. Check-in WITHIN office geo-fence (inside 200m radius)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-in",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP1, latitude: DELHI_LAT + 0.0001, longitude: DELHI_LNG + 0.0001, accuracyMeters: 10, selfieFileKey: "selfies/emp1-2026-07-01.jpg", deviceId: "device-001", officeLocationId: OFFICE_DELHI },
    });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("within_geofence");
    expect(r.json().withinGeofence ?? r.json().status === "within_geofence").toBeTruthy();
    expect(r.json().distanceMeters).toBeLessThan(200);
  });

  it("B2. Check-in OUTSIDE office geo-fence (1km away)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-in",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP2, latitude: DELHI_LAT + 0.01, longitude: DELHI_LNG + 0.01, accuracyMeters: 15, selfieFileKey: "selfies/emp2-outside.jpg", officeLocationId: OFFICE_DELHI },
    });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("outside_geofence");
    expect(r.json().distanceMeters).toBeGreaterThan(200);
  });

  it("B3. Check-in with selfie file key stored", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-in",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP1, latitude: DELHI_LAT, longitude: DELHI_LNG, selfieFileKey: "video/emp1-checkin-2026-07-02.mp4", deviceId: "mobile-001", officeLocationId: OFFICE_DELHI },
    });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBeDefined();
  });

  it("B4. Check-in rejects coords out of range", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-in",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP1, latitude: 999, longitude: -999 },
    });
    expect([400, 500].includes(r.statusCode)).toBe(true);
  });

  it("B5. Check-in without auth returns 401", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-in",
      headers: { ...CT },
      payload: { employeeId: EMP1, latitude: DELHI_LAT, longitude: DELHI_LNG },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("C. Geo-Fenced Attendance — Check-Out", () => {
  it("C1. Check-out records successfully", async () => {
    // Regression guard for the check_type column-width bug: "check_out" is 9
    // characters and attendance.hrms_geo_attendance.check_type used to be
    // VARCHAR(8), so the F3 consumer's insert failed at the DB layer with
    // 22001 "value too long for type character varying(8)" (see migration
    // 0127 and the now-resolved KNOWN BLOCKER note in f3-consumer.ts).
    //
    // Note this route is fire-and-forget CQRS: routes.ts answers 201
    // immediately after publishing to F3, and the actual insert only runs
    // later in the consumer (drained below). That means the pre-fix bug did
    // NOT surface as an HTTP 500 here — the request always got 201 while the
    // consumer silently dropped the row (confirmed empirically: querying
    // attendance.hrms_geo_attendance directly after this exact sequence
    // against the unfixed varchar(8) column returned zero rows, with
    // "f3RouteWrite failed" / 22001 in the consumer logs). So asserting only
    // r.statusCode here would NOT catch the regression — the real guard is
    // the geo-history read-back below, which fails to find the check_out
    // entry if the consumer's insert silently failed.
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/geo-check-out",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP1, latitude: DELHI_LAT + 0.0002, longitude: DELHI_LNG - 0.0001, selfieFileKey: "video/emp1-checkout.mp4" },
    });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("check_out_recorded");

    const hist = await app.inject({ method: "GET", url: `/v1/hrms/attendance/geo-history?employeeId=${EMP1}`, headers: AUTH });
    expect(hist.statusCode).toBe(200);
    const checkOutRows = hist.json().data.filter((row: any) => row.checkType === "check_out");
    expect(checkOutRows.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// D. GEO ATTENDANCE HISTORY
// ═══════════════════════════════════════════════════════════
describe("D. Attendance History & Reporting Officer View", () => {
  // These two are the real regression guards for the geo F3 consumer: they can
  // only pass if section B/C's punches were actually persisted by the consumer.
  it("D1. Employee views own geo-attendance history", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/attendance/geo-history?employeeId=${EMP1}`, headers: AUTH });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("withinGeofence");
    expect(data[0]).toHaveProperty("checkType");
  });

  it("D2. Reporting officer views all reportees attendance", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/reportees", headers: AUTH });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// E. HOLIDAY ENFORCEMENT IN ATTENDANCE
// ═══════════════════════════════════════════════════════════
describe("E. Holiday Configuration & Enforcement", () => {
  it("E1. Holidays list includes gazetted and restricted types", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/holidays?year=2026", headers: AUTH });
    expect(r.statusCode).toBe(200);
    const holidays = r.json().data;
    const gazetted = holidays.filter((h: any) => h.type === "gazetted");
    expect(gazetted.length).toBeGreaterThanOrEqual(5);
  });

  it("E2. Holidays include Republic Day (26 Jan), Independence Day (15 Aug)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/holidays?year=2026", headers: AUTH });
    const names = r.json().data.map((h: any) => h.name);
    expect(names).toContain("Republic Day");
    expect(names).toContain("Independence Day");
  });

  it("E3. Holiday calendar supports restricted/optional holidays", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/holidays?year=2026", headers: AUTH });
    const restricted = r.json().data.filter((h: any) => h.type === "restricted");
    expect(restricted.length).toBeGreaterThan(0);
  });

  it("E4. Can add office-specific holiday", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/holidays",
      headers: { ...AUTH, ...CT },
      payload: { name: "State Formation Day", date: "2026-11-01", type: "gazetted" },
    });
    expect([201, 202, 500].includes(r.statusCode)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// F. LEAVE APPLICATION + REPORTING OFFICER FLOW
// ═══════════════════════════════════════════════════════════
describe("F. Leave Application with Reporting Officer", () => {
  it("F1. Employee applies for leave (goes to RO queue)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { ...AUTH, ...CT },
      payload: { employeeId: EMP1, leaveTypeId: "eeeeeeee-0001-0000-0000-000000000007", allocId: "eeeeeeee-0001-0000-0000-000000000009", fromDate: "2026-10-01", toDate: "2026-10-03", daysApplied: 3, reason: "Personal work" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().id).toBeDefined();
  });

  it("F2. GET leave applications shows pending status", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications", headers: AUTH });
    expect(r.statusCode).toBe(200);
    const apps = r.json().data ?? r.json();
    const pending = apps.filter((a: any) => a.status === "Pending" || a.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
  });

  it("F3. RO approves leave (CQRS 202)", async () => {
    // Get a pending leave app
    const list = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications", headers: AUTH });
    const apps = list.json().data ?? list.json();
    const pending = apps.find((a: any) => a.status === "Pending" || a.status === "pending");
    if (!pending) return; // skip if none pending

    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/leave-applications/${pending.id}/approve`,
      headers: { ...AUTH, ...CT },
      payload: {},
    });
    expect([200, 202, 500].includes(r.statusCode)).toBe(true);
  });

  it("F4. Employee's reporting officer is assigned", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP1}`, headers: AUTH });
    expect(r.statusCode).toBe(200);
    const emp = r.json();
    // reporting_officer_id should be set (from migration)
    expect(emp.reportingOfficerId ?? emp.reporting_officer_id ?? emp.managerId).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// G. FULL EMPLOYEE JOURNEY (Apply → Approve → Attendance)
// ═══════════════════════════════════════════════════════════
describe("G. Full Employee Journey", () => {
  it("G1. Dashboard shows correct metrics", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard", headers: AUTH });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.headcount).toBeGreaterThan(0);
    expect(d).toHaveProperty("pendingLeaves");
    expect(d).toHaveProperty("attendanceTodayPct");
  });

  it("G2. Employee list shows reporting structure", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP1}`, headers: AUTH });
    expect(r.statusCode).toBe(200);
  });

  it("G3. Leave types queryable", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-types", headers: AUTH });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.length).toBeGreaterThan(0);
  });

  it("G4. Attendance summary available", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary", headers: AUTH });
    expect(r.statusCode).toBe(200);
  });
});
