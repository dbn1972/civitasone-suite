/**
 * Manager/self/HR-scope regression test for the three face-verification
 * sibling endpoints flagged out-of-scope in PR #1682 (the face-log IDOR
 * fix): POST/GET /v1/hrms/employees/:id/profile-photo and
 * POST /v1/hrms/attendance/verify-face -- real-DB round-trip. Mirrors the
 * shape of face-log-manager-scope-real-db.test.ts (PR #1682) and
 * attendance-manager-scope-real-db.test.ts (GAP-HR-SF-10/SF-16) -- same
 * fixture/token conventions, same asTenant() raw-SQL seeding
 * (employee.hrms_profile_photos has FORCE ROW LEVEL SECURITY, same as
 * attendance.hrms_face_verification_log, so seeding goes through
 * withRawTenantGuc exactly like those two files).
 *
 * SEC finding (found while reading this file end-to-end for PR #1682, which
 * fixed only the sibling face-log GET route and flagged these three as a
 * separate follow-up rather than silently fixing or silently ignoring
 * them): all three routes accepted a target employeeId (URL param or
 * request body) under ALL_ROLES with NO check it was the caller's own (or,
 * for the read route, a direct report's) resolved employee id. This is
 * biometric-verification data (profile photos underlie face-match; verify-
 * face runs the match pipeline and writes a face-verification-log row) --
 * DPDP/PII-sensitive, see this PR's description for the required human
 * review flag.
 *
 * Fixed: each route now resolves its target employeeId through a scope
 * function in routes.ts (resolveProfilePhotoWriteScope /
 * resolveProfilePhotoReadScope / resolveVerifyFaceScope) -- see those
 * functions' doc comments for why each has a DIFFERENT allowed-caller shape
 * (self-or-HR for upload; self/manager's-report/HR for read; strictly
 * self-only, no exceptions, for verify-face).
 *
 * The profile-photo GET response intentionally omits `employeeId` from its
 * body (see routes.ts's field-mapping), so the read-scope tests below
 * identify "whose data came back" by seeding exactly one distinguishable
 * hrms_profile_photos row per employee (a controlled `id`) and asserting on
 * that id, the same convention face-log-manager-scope-real-db.test.ts uses.
 *
 * The two write routes (upload, verify-face) queue their actual persistence
 * asynchronously via publishF3Write -> the f3RouteWrite consumer, so these
 * tests assert on the synchronous HTTP response the authorization gate
 * produces (403 before anything is queued for a denied caller; 201, or for
 * verify-face the well-defined 400 NO_PROFILE_PHOTO business-logic error,
 * for an authorized one) rather than on eventual consumer-applied DB state
 * -- that queued-write plumbing is unchanged by, and orthogonal to, this
 * authorization fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT    = "0badface-0000-4000-8000-000000000000";
const SEED_ACTOR = "0badface-0000-4000-8000-0000000000ff";
const DEPT_ID    = "0badface-0000-4000-8000-0000000000d1";
const DESIG_ID   = "0badface-0000-4000-8000-0000000000d2";

const MANAGER_ID  = "0badface-0000-4000-8000-0000000000e1";
const REPORT1_ID  = "0badface-0000-4000-8000-0000000000e2";
const OUTSIDER_ID = "0badface-0000-4000-8000-0000000000e3"; // same tenant, NOT a report of MANAGER_ID
// Linked employee record, deliberately given NO hrms_profile_photos row --
// see the verify-face describe block below for why: verify-face's real
// handler calls the live ONNX/Rekognition pipeline once a profile photo IS
// found, so the "self passes the auth gate" proof intentionally uses an
// identity where the route's first business-logic check after the
// authorization gate (NO_PROFILE_PHOTO) is what fires, instead of exercising
// (and depending on the availability of) that pipeline in this test.
const NOPHOTO_ID  = "0badface-0000-4000-8000-0000000000e4";
// Two more linked employees, ALSO deliberately given no hrms_profile_photos
// row, and (unlike every id above) never targeted by more than one test
// each: hrms_profile_photos has a UNIQUE(tenant_id, employee_id) constraint,
// and the queued upload consumer's "deactivate old, insert new" upsert
// (face-verification/f3-consumer.ts's face_verification_routes__0 case)
// inserts the new row WITHOUT changing the old (now-inactive) row's
// employee_id -- so a SECOND queued upload for an employee that already has
// ANY row (active or not) collides with this unique constraint in the
// background consumer. That's a latent, pre-existing bug in that consumer,
// unrelated to this PR's authorization fix and out of scope to fix here
// (mirrors this same file's own already-documented, deliberately-untouched
// face_verification_routes__1 TODO) -- so rather than risk this test suite
// tripping it and reporting a flaky/wrong result, each of the two tests
// below that expect a successful (201) upload gets its own identity that no
// other test in this file ever uploads a photo for.
const UPLOAD_SELF_ID = "0badface-0000-4000-8000-0000000000e5";
const UPLOAD_HR_TARGET_ID = "0badface-0000-4000-8000-0000000000e6";

const MANAGER_PHOTO_ID  = "0badface-0000-4000-8000-0000000000a1";
const REPORT1_PHOTO_ID  = "0badface-0000-4000-8000-0000000000a2";
const OUTSIDER_PHOTO_ID = "0badface-0000-4000-8000-0000000000a3";

const MANAGER_SUB      = "profile-scope-mgr";
const REPORT1_SUB      = "profile-scope-report1";
const OUTSIDER_SUB     = "profile-scope-outsider";
const UNLINKED_MGR_SUB = "profile-scope-unlinked-mgr";
const HR_SUB           = "profile-scope-hr";
const NOPHOTO_SUB      = "profile-scope-nophoto";
const UPLOAD_SELF_SUB  = "profile-scope-upload-self";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-profile-scope-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const report1Token     = tok(["employee"], REPORT1_SUB);
const outsiderToken    = tok(["employee"], OUTSIDER_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);
const hrToken          = tok(["hr_admin"], HR_SUB);
const nophotoToken     = tok(["employee"], NOPHOTO_SUB);
const uploadSelfToken  = tok(["employee"], UPLOAD_SELF_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_profile_photos WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

const EMPLOYEES = [
  [MANAGER_ID, "PFACEPHO-001", "Profile Photo Scope Manager", undefined, MANAGER_SUB],
  [REPORT1_ID, "PFACEPHO-002", "Profile Photo Scope Report One", MANAGER_ID, REPORT1_SUB],
  [OUTSIDER_ID, "PFACEPHO-003", "Profile Photo Scope Outsider", undefined, OUTSIDER_SUB],
  [NOPHOTO_ID, "PFACEPHO-004", "Profile Photo Scope Nophoto", undefined, NOPHOTO_SUB],
  [UPLOAD_SELF_ID, "PFACEPHO-005", "Profile Photo Scope Upload Self", undefined, UPLOAD_SELF_SUB],
  [UPLOAD_HR_TARGET_ID, "PFACEPHO-006", "Profile Photo Scope Upload HR Target", undefined, undefined],
] as const;

const PROFILE_PHOTOS = [
  [MANAGER_PHOTO_ID, MANAGER_ID],
  [REPORT1_PHOTO_ID, REPORT1_ID],
  [OUTSIDER_PHOTO_ID, OUTSIDER_ID],
] as const;

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'PFACEPHO', 'Profile Photo Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'PFACEPHO', 'Profile Photo Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const [id, empNo, name, managerId, userRef] of EMPLOYEES) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
      VALUES
        (${id}, ${TENANT}, ${empNo}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${managerId ?? null}, ${userRef ?? null}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  for (const [photoId, employeeId] of PROFILE_PHOTOS) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_profile_photos
        (id, tenant_id, employee_id, photo_key, photo_bucket, is_active)
      VALUES
        (${photoId}, ${TENANT}, ${employeeId}, 'test-photo-key', 'civitasone-photos', true)
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function getProfilePhoto(employeeId: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await app.inject({
    method: "GET",
    url: `/v1/hrms/employees/${employeeId}/profile-photo`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}

async function uploadProfilePhoto(employeeId: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await app.inject({
    method: "POST",
    url: `/v1/hrms/employees/${employeeId}/profile-photo`,
    headers: { authorization: `Bearer ${token}` },
    payload: { photoKey: "new-selfie-key.jpg" },
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}

async function verifyFace(employeeId: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await app.inject({
    method: "POST",
    url: "/v1/hrms/attendance/verify-face",
    headers: { authorization: `Bearer ${token}` },
    payload: { employeeId, selfieKey: "live-selfie-key.jpg" },
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}

describe("GET /v1/hrms/employees/:id/profile-photo — self/manager/HR scope (SEC, biometric data)", () => {
  it("self (bare employee) requesting their OWN id: 200, sees only their own photo", async () => {
    const { status, body } = await getProfilePhoto(REPORT1_ID, report1Token);
    expect(status).toBe(200);
    expect(body.id).toBe(REPORT1_PHOTO_ID);
  });

  it("REPRODUCTION: a bare employee requesting a DIFFERENT employee's id is blocked -- this was the live IDOR", async () => {
    const { status } = await getProfilePhoto(OUTSIDER_ID, report1Token);
    expect(status).toBe(403);
  });

  it("manager requesting a real direct report's id: 200, scoped to just that report's photo", async () => {
    const { status, body } = await getProfilePhoto(REPORT1_ID, managerToken);
    expect(status).toBe(200);
    expect(body.id).toBe(REPORT1_PHOTO_ID);
  });

  it("manager requesting their OWN id: 200 -- must not be locked out of their own data", async () => {
    const { status, body } = await getProfilePhoto(MANAGER_ID, managerToken);
    expect(status).toBe(200);
    expect(body.id).toBe(MANAGER_PHOTO_ID);
  });

  it("manager requesting the OUTSIDER's id (not a direct report): denied, not substituted", async () => {
    const { status } = await getProfilePhoto(OUTSIDER_ID, managerToken);
    expect(status).toBe(403);
  });

  it("manager with NO resolvable employee link: denied even for a real employee's id (fails closed)", async () => {
    const { status } = await getProfilePhoto(REPORT1_ID, unlinkedMgrToken);
    expect(status).toBe(403);
  });

  it("HR sees a report's photo -- broader access preserved", async () => {
    const { status, body } = await getProfilePhoto(REPORT1_ID, hrToken);
    expect(status).toBe(200);
    expect(body.id).toBe(REPORT1_PHOTO_ID);
  });

  it("HR sees the OUTSIDER's photo too -- tenant-wide HR access is unaffected by the scoping fix", async () => {
    const { status, body } = await getProfilePhoto(OUTSIDER_ID, hrToken);
    expect(status).toBe(200);
    expect(body.id).toBe(OUTSIDER_PHOTO_ID);
  });
});

describe("POST /v1/hrms/employees/:id/profile-photo — self-or-HR scope, no manager override (SEC, biometric data)", () => {
  it("self (bare employee) uploading their OWN photo: 201", async () => {
    const { status } = await uploadProfilePhoto(UPLOAD_SELF_ID, uploadSelfToken);
    expect(status).toBe(201);
  });

  it("REPRODUCTION: a bare employee uploading a DIFFERENT employee's photo is blocked -- this was the live IDOR (and an attendance-fraud vector: overwriting a colleague's registered face)", async () => {
    const { status } = await uploadProfilePhoto(OUTSIDER_ID, report1Token);
    expect(status).toBe(403);
  });

  it("HR uploads on behalf of any employee: 201 -- the documented onboarding workflow is preserved", async () => {
    const { status } = await uploadProfilePhoto(UPLOAD_HR_TARGET_ID, hrToken);
    expect(status).toBe(201);
  });

  it("a manager uploading a DIRECT REPORT's photo is still denied -- unlike the read route, there is no manager on-behalf-of allowance for uploads", async () => {
    const { status } = await uploadProfilePhoto(REPORT1_ID, managerToken);
    expect(status).toBe(403);
  });

  it("manager with NO resolvable employee link: denied even for a real employee's id (fails closed)", async () => {
    const { status } = await uploadProfilePhoto(REPORT1_ID, unlinkedMgrToken);
    expect(status).toBe(403);
  });
});

describe("POST /v1/hrms/attendance/verify-face — self-only scope, no manager/HR override (SEC, biometric data)", () => {
  it("self verifying their OWN face: NOT blocked by authorization (400 NO_PROFILE_PHOTO from reaching real business logic, not 403) -- NOPHOTO_ID deliberately has no hrms_profile_photos row, so this proves the request got PAST the auth gate without depending on the live ONNX/Rekognition pipeline", async () => {
    const { status, body } = await verifyFace(NOPHOTO_ID, nophotoToken);
    expect(status).toBe(400);
    expect(body.code).toBe("NO_PROFILE_PHOTO");
  });

  it("REPRODUCTION: a bare employee attempting to verify-face against a DIFFERENT employee's id is blocked -- this was the live IDOR (could otherwise fabricate a verified/failed biometric attendance record for a colleague, or probe whether an arbitrary selfie matches their registered face). Denied before the target's profile photo is ever looked up, regardless of whether one exists.", async () => {
    const { status } = await verifyFace(OUTSIDER_ID, report1Token);
    expect(status).toBe(403);
  });

  it("a manager attempting verify-face on behalf of a direct report is denied -- no on-behalf-of workflow exists for this route, unlike the read route above", async () => {
    const { status } = await verifyFace(REPORT1_ID, managerToken);
    expect(status).toBe(403);
  });

  it("HR attempting verify-face on behalf of any employee is ALSO denied -- unlike the other two routes, this one has no HR override at all", async () => {
    const { status } = await verifyFace(OUTSIDER_ID, hrToken);
    expect(status).toBe(403);
  });

  it("manager with NO resolvable employee link: denied even for a real employee's id (fails closed)", async () => {
    const { status } = await verifyFace(REPORT1_ID, unlinkedMgrToken);
    expect(status).toBe(403);
  });

  it("the outsider (bare employee) attempting to verify a DIFFERENT identity's (NOPHOTO_ID's) face is also denied -- confirms self-only holds from a second caller, not just report1", async () => {
    const { status } = await verifyFace(NOPHOTO_ID, outsiderToken);
    expect(status).toBe(403);
  });
});
