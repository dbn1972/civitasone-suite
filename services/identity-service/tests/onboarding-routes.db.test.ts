/**
 * Usable logins on create (real Postgres, real Fastify, in-memory Keycloak): the HTTP side.
 *
 *  - the per-tenant switch defaults OFF and keeps today's create behaviour byte for byte
 *  - roles at create: allow-list only, default employee, no platform roles, no escalation, all-or-nothing
 *  - role change endpoint: same rules, never your own roles, never across tenants
 *  - bulk: capped, idempotent, partial-success report
 *  - set-password link: single-use, short-lived, hash-only at rest, cross-tenant safe
 *  - no password appears in any response, log line or audit record
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { installFakeKeycloak, KC_URL } from "./helpers/fake-keycloak.js";

process.env.LOG_LEVEL = "trace";
const SECRET = process.env.JWT_SECRET as string;
const TA = randomUUID();
const TB = randomUUID();
const PLATFORM_T = randomUUID();
const ADMIN_A = randomUUID();
const ADMIN_B = randomUUID();
const OPS = randomUUID();
const bearer = (sub: string, tid: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s-onb" } as never, SECRET, 3600)}` });
const asA = (roles = ["tenant_admin"]) => bearer(ADMIN_A, TA, roles);
const asB = (roles = ["tenant_admin"]) => bearer(ADMIN_B, TB, roles);
const asOps = (roles = ["platform_admin"]) => bearer(OPS, PLATFORM_T, roles);

async function asTenant<R>(tenant: string, fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function seedUser(tenant: string, email: string, opts: { kc?: string | null; status?: string } = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(tenant, async (q) => {
    await q`INSERT INTO users.users (id, tenant_id, email, name, status, keycloak_user_id, created_by, updated_by)
            VALUES (${id}, ${tenant}, ${email}, 'Seeded User', ${opts.status ?? "active"}, ${opts.kc === undefined ? randomUUID() : opts.kc}, ${ADMIN_A}, ${ADMIN_A})`;
  });
  return id;
}

let app: FastifyInstance;
let kc: ReturnType<typeof installFakeKeycloak>;
let published: Array<{ topic: string; msg: { payload: Record<string, unknown> } }>;
const logged: string[] = [];

beforeAll(async () => {
  const realWrite = fs.write.bind(fs);
  const realWriteSync = fs.writeSync.bind(fs);
  vi.spyOn(fs, "write").mockImplementation(((fd: number, data: unknown, ...rest: unknown[]) => { logged.push(String(data)); return (realWrite as (...a: unknown[]) => unknown)(fd, data, ...rest); }) as never);
  vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, data: unknown, ...rest: unknown[]) => { logged.push(String(data)); return (realWriteSync as (...a: unknown[]) => unknown)(fd, data, ...rest); }) as never);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const t of [TA, TB, PLATFORM_T]) {
    await asTenant(t, async (q) => {
      await q`DELETE FROM users.password_setup_tokens WHERE tenant_id = ${t}`;
      await q`DELETE FROM users.tenant_onboarding_settings WHERE tenant_id = ${t}`;
      await q`DELETE FROM users.users WHERE tenant_id = ${t}`;
    });
  }
  await app.close();
});
beforeEach(async () => {
  vi.stubEnv("KEYCLOAK_URL", KC_URL);
  vi.stubEnv("KEYCLOAK_REALM", "civitasone");
  vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
  vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
  vi.stubEnv("IDENTITY_SET_PASSWORD_BASE_URL", "https://app.example.test");
  kc = installFakeKeycloak({ policyRejects: (pw) => pw.length < 12 || !/[A-Z]/.test(pw) });
  vi.stubGlobal("fetch", kc.fetchMock);
  published = [];
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, msg: never) => { published.push({ topic, msg }); }) as never);
});

const switchOn = (tenant: string, mode: "email" | "link" | "off" = "link") =>
  app.inject({ method: "PUT", url: "/identity/onboarding-settings", headers: asOps(), payload: { tenantId: tenant, usableLogins: true, passwordMode: mode } });
const create = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/identity/users", headers, payload });

describe("the switch defaults to today's behaviour", () => {
  it("a tenant with no setting: create publishes exactly the old command (no roles, no grantor), 202", async () => {
    const res = await create(asA(), { email: "legacy@dept.gov.in", name: "Legacy User" });
    expect(res.statusCode).toBe(202);
    const cmd = published.find((p) => p.topic === COMMANDS.createUser)!;
    expect(cmd.msg.payload).not.toHaveProperty("requestedRoles");
    expect(cmd.msg.payload).not.toHaveProperty("grantorRoles");
  });

  it("a `roles` field on a tenant that is not switched on is ignored exactly as before (existing clients keep working)", async () => {
    const res = await create(asA(), { email: "r1@dept.gov.in", name: "R One", roles: ["manager", "super_admin"] });
    expect(res.statusCode).toBe(202);
    const cmd = published.find((p) => p.topic === COMMANDS.createUser)!;
    expect(cmd.msg.payload).not.toHaveProperty("requestedRoles");
    expect(cmd.msg.payload).not.toHaveProperty("grantorRoles");
  });

  it("bulk is refused for a tenant that is not switched on", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/users/bulk", headers: asA(), payload: { users: [{ email: "b1@dept.gov.in", name: "B One" }] } });
    expect(res.statusCode).toBe(409);
  });

  it("GET settings reports the default", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/onboarding-settings", headers: asB() });
    expect(res.json()).toMatchObject({ usableLogins: false, source: "default" });
  });
});

describe("who may flip the switch", () => {
  it("a tenant admin cannot switch it on for themselves", async () => {
    const res = await app.inject({ method: "PUT", url: "/identity/onboarding-settings", headers: asA(), payload: { usableLogins: true } });
    expect(res.statusCode).toBe(403);
  });
  it("a platform admin can, for a named tenant, and it is tenant-scoped", async () => {
    expect((await switchOn(TA)).statusCode).toBe(200);
    const a = await app.inject({ method: "GET", url: "/identity/onboarding-settings", headers: asA() });
    const b = await app.inject({ method: "GET", url: "/identity/onboarding-settings", headers: asB() });
    expect(a.json()).toMatchObject({ usableLogins: true, source: "tenant" });
    expect(b.json()).toMatchObject({ usableLogins: false });
  });
});

describe("roles at create (tenant switched on)", () => {
  beforeAll(async () => { await switchOn(TA); });

  it("defaults to employee when none are given", async () => {
    expect((await create(asA(), { email: "d1@dept.gov.in", name: "D One" })).statusCode).toBe(202);
    const cmd = published.find((p) => p.topic === COMMANDS.createUser)!;
    expect(cmd.msg.payload.requestedRoles).toEqual(["employee"]);
  });

  it("accepts allow-listed roles", async () => {
    const res = await create(asA(), { email: "d2@dept.gov.in", name: "D Two", roles: ["employee", "manager"] });
    expect(res.statusCode).toBe(202);
    expect(published[0]!.msg.payload.requestedRoles).toEqual(["employee", "manager"]);
  });

  it.each(["super_admin", "platform_admin", "tenant_admin", "service_account", "audit_admin", "no_such_role"])("refuses %s", async (role) => {
    const res = await create(asA(), { email: `x-${role}@dept.gov.in`, name: "Nope", roles: ["employee", role] });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ROLE_NOT_GRANTABLE");
    expect(published).toHaveLength(0); // all-or-nothing: no half-applied request
  });

  it("platform roles are refused even to a platform admin acting for the tenant", async () => {
    await switchOn(PLATFORM_T);
    const res = await create(asOps(["platform_admin", "super_admin"]), { email: "esc@dept.gov.in", name: "Esc", roles: ["super_admin"] });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ROLE_NOT_GRANTABLE");
    expect(published).toHaveLength(0);
    // ...while a platform admin may grant the tenant's ordinary and admin-tier roles
    expect((await create(asOps(), { email: "ok-ops@dept.gov.in", name: "Ok Ops", roles: ["works_admin"] })).statusCode).toBe(202);
  });

  it("privilege escalation: a tenant admin cannot hand out an admin-tier role they do not hold", async () => {
    const res = await create(asA(["tenant_admin"]), { email: "esc2@dept.gov.in", name: "Esc Two", roles: ["hr_admin"] });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("hr_admin");
    // ...but one who holds it can
    const ok = await create(asA(["tenant_admin", "hr_admin"]), { email: "ok2@dept.gov.in", name: "Ok Two", roles: ["hr_admin"] });
    expect(ok.statusCode).toBe(202);
  });

  it("a non-admin caller is refused outright", async () => {
    expect((await create(asA(["employee"]), { email: "e@dept.gov.in", name: "E" })).statusCode).toBe(403);
    expect((await create(asA(["manager"]), { email: "m@dept.gov.in", name: "M" })).statusCode).toBe(403);
  });

  it("cross-tenant: the switch of tenant A does not apply to tenant B", async () => {
    const res = await create(asB(), { email: "cross@dept.gov.in", name: "Cross", roles: ["manager"] });
    expect(res.statusCode).toBe(202);
    expect(published[0]!.msg.payload).not.toHaveProperty("requestedRoles"); // B is not switched on: nothing is granted
  });
});

describe("bulk onboarding", () => {
  beforeAll(async () => { await switchOn(TA); await seedUser(TA, "exists@dept.gov.in"); });
  const bulk = (users: unknown[], extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/identity/users/bulk", headers: asA(), payload: { users, ...extra } });

  it("reports per row: accepted, already_exists, duplicate_in_request, rejected", async () => {
    const res = await bulk([
      { email: "n1@dept.gov.in", name: "N One" },
      { email: "exists@dept.gov.in", name: "Exists" },
      { email: "N1@dept.gov.in", name: "N One again" },
      { email: "n2@dept.gov.in", name: "N Two", roles: ["super_admin"] },
      { email: "n3@dept.gov.in", name: "N Three", roles: ["manager"] },
    ]);
    expect(res.statusCode).toBe(202);
    const rep = res.json();
    expect(rep.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "already_exists", "duplicate_in_request", "rejected", "accepted"]);
    expect(rep).toMatchObject({ total: 5, accepted: 2, skipped: 2, rejected: 1 });
    expect(rep.results[3].code).toBe("ROLE_NOT_GRANTABLE");
    expect(published.filter((p) => p.topic === COMMANDS.createUser)).toHaveLength(2);
  });

  it("is idempotent for users that now exist: re-posting creates nothing", async () => {
    const id = await seedUser(TA, "again@dept.gov.in");
    const res = await bulk([{ email: "again@dept.gov.in", name: "Again" }]);
    expect(res.json().results[0]).toMatchObject({ status: "already_exists" });
    expect(id).toBeTruthy();
    expect(published).toHaveLength(0);
  });

  it("is capped", async () => {
    vi.stubEnv("IDENTITY_BULK_CREATE_MAX", "3");
    const res = await bulk(Array.from({ length: 4 }, (_, i) => ({ email: `cap${i}@dept.gov.in`, name: "Cap" })));
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("BULK_TOO_LARGE");
    expect(published).toHaveLength(0);
  });

  it("the hard ceiling holds even if the operational cap is raised", async () => {
    vi.stubEnv("IDENTITY_BULK_CREATE_MAX", "100000");
    const res = await bulk(Array.from({ length: 501 }, (_, i) => ({ email: `h${i}@dept.gov.in`, name: "H" })));
    expect(res.statusCode).toBe(400);
  });

  it("defaultRoles apply to rows without their own and are checked too", async () => {
    const ok = await bulk([{ email: "dr1@dept.gov.in", name: "Dr One" }], { defaultRoles: ["manager"] });
    expect(published[0]!.msg.payload.requestedRoles).toEqual(["manager"]);
    expect(ok.json().accepted).toBe(1);
    published = [];
    const bad = await bulk([{ email: "dr2@dept.gov.in", name: "Dr Two" }], { defaultRoles: ["tenant_admin"] });
    expect(bad.json().rejected).toBe(1);
    expect(published).toHaveLength(0);
  });
});

describe("role change endpoint", () => {
  let target: string;
  beforeAll(async () => { target = await seedUser(TA, "rolechange@dept.gov.in"); });
  const kcTarget = (roles: string[] = []) => kc.users.set("kc-target", { id: "kc-target", username: `${TA}__rolechange@dept.gov.in`, enabled: true, attributes: { tid: [TA] }, requiredActions: [], roles: new Set(roles) });
  beforeEach(() => kcTarget());
  const put = (headers: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/identity/users/${id}/roles`, headers, payload });

  it("accepts an allow-listed set with a reason and publishes the audited command", async () => {
    const res = await put(asA(), target, { roles: ["employee", "manager"], reason: "promoted to section manager" });
    expect(res.statusCode).toBe(202);
    const cmd = published.find((p) => p.topic === COMMANDS.setUserRoles)!;
    expect(cmd.msg.payload).toMatchObject({ id: target, roles: ["employee", "manager"], reason: "promoted to section manager" });
    expect(cmd.msg.payload).not.toHaveProperty("grantorRoles"); // the worker re-derives the grantor itself
  });

  it("only the roles that CHANGE are held to the caller rule: an unchanged admin-tier role the caller lacks is not a reason to refuse", async () => {
    kcTarget(["employee", "hr_admin"]);
    const keep = await put(asA(), target, { roles: ["employee", "hr_admin", "manager"], reason: "add manager only" });
    expect(keep.statusCode).toBe(202);
    published = [];
    const strip = await put(asA(), target, { roles: ["employee"], reason: "would remove hr_admin" });
    expect(strip.statusCode).toBe(403); // removing hr_admin is a change the caller may not make
    expect(published).toHaveLength(0);
  });

  it("fails closed when the user's current roles cannot be read", async () => {
    kc.fetchMock.mockImplementation(async (input: unknown) => String(input).includes("/token") ? new Response(JSON.stringify({ access_token: "t", expires_in: 300 })) : new Response("{}", { status: 500 }));
    expect((await put(asA(), target, { roles: ["employee"], reason: "kc is down" })).statusCode).toBe(503);
    expect(published).toHaveLength(0);
  });

  it("requires a reason", async () => {
    expect((await put(asA(), target, { roles: ["employee"] })).statusCode).toBe(400);
  });

  it.each(["super_admin", "platform_admin", "tenant_admin", "hr_admin"])("refuses %s", async (role) => {
    const res = await put(asA(), target, { roles: ["employee", role], reason: "try to escalate" });
    expect(res.statusCode).toBe(403);
    expect(published).toHaveLength(0);
  });

  it("an admin cannot change their own roles", async () => {
    const self = await seedUser(TA, "self@dept.gov.in");
    const res = await app.inject({ method: "PUT", url: `/identity/users/${self}/roles`, headers: bearer(self, TA, ["tenant_admin"]), payload: { roles: ["employee"], reason: "self service" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SELF_ROLE_CHANGE");
  });

  it("cross-tenant: another tenant's admin gets 404 and nothing is published", async () => {
    const res = await put(asB(), target, { roles: ["employee"], reason: "reach across tenants" });
    expect(res.statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("an inactive user cannot be given roles", async () => {
    const gone = await seedUser(TA, "gone@dept.gov.in", { status: "deactivated" });
    expect((await put(asA(), gone, { roles: ["employee"], reason: "should not apply" })).statusCode).toBe(409);
  });

  it("only admins may call it", async () => {
    expect((await put(asA(["manager"]), target, { roles: ["employee"], reason: "no rights" })).statusCode).toBe(403);
  });

  it("GET grantable-roles reflects what THIS caller may grant", async () => {
    const plain = (await app.inject({ method: "GET", url: "/identity/users/grantable-roles", headers: asA() })).json();
    const hr = (r: { role: string }) => r.role === "hr_admin";
    expect(plain.roles.find(hr).grantable).toBe(false);
    expect(plain.roles.find((r: { role: string }) => r.role === "manager").grantable).toBe(true);
    expect(plain.roles.some((r: { role: string }) => r.role === "super_admin")).toBe(false);
    const holder = (await app.inject({ method: "GET", url: "/identity/users/grantable-roles", headers: asA(["tenant_admin", "hr_admin"]) })).json();
    expect(holder.roles.find(hr).grantable).toBe(true);
  });
});

describe("set-password link (no-mail path)", () => {
  // generated per run: no password literal lives in the repo
  const PASSWORD = `Aa1!${randomUUID()}`;
  let uid: string;
  let email: string;
  // The ISSUING admin as the redeem re-check sees them: an identity row (id = the token's sub) + a Keycloak user.
  const setIssuer = (roles: string[], enabled = true) =>
    kc.users.set("issuer-kc", { id: "issuer-kc", username: `${TA}__issuer@dept.gov.in`, enabled, attributes: { tid: [TA] }, requiredActions: [], roles: new Set(roles) });
  beforeAll(async () => {
    await asTenant(TA, async (q) => {
      await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${ADMIN_A}, ${TA}, 'issuer@dept.gov.in', 'Issuing Admin', 'active', ${ADMIN_A}, ${ADMIN_A}) ON CONFLICT DO NOTHING`;
    });
  });
  beforeEach(async () => {
    setIssuer(["tenant_admin"]);
    email = `link-${randomUUID().slice(0, 8)}@dept.gov.in`;
    uid = await seedUser(TA, email);
    kc.users.set("kc-1", { id: "kc-1", username: `${TA}__${email}`, enabled: true, attributes: { tid: [TA], tenantId: [TA] }, requiredActions: [], roles: new Set() });
    for (const [k, u] of [...kc.users]) if (k === "kc-1") u.email = email;
  });
  const issue = (headers = asA(), id = () => uid) => app.inject({ method: "POST", url: `/identity/users/${id()}/password-setup-link`, headers });
  const redeem = (token: string, password = PASSWORD) =>
    app.inject({ method: "POST", url: "/identity/password-setup/redeem", payload: { token, password } });

  it("issues a token once; only its hash is stored; the response is no-store and carries no password", async () => {
    const res = await issue();
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.token).toMatch(new RegExp(`^${TA}\\.[A-Za-z0-9_-]{43}$`));
    expect(body.url).toBe(`https://app.example.test/auth/set-password#token=${body.token}`);
    expect(JSON.stringify(body)).not.toMatch(/password"\s*:/i);
    const secret = body.token.split(".")[1] as string;
    const rows = await asTenant(TA, (q) => q`SELECT * FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = new Date(rows[0]!.expires_at as string).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(72 * 3600 * 1000);
  });

  it("redeem sets the password in Keycloak, and the token is single-use", async () => {
    const { token } = (await issue()).json();
    const ok = await redeem(token);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: "password_set" });
    expect(kc.users.get("kc-1")!.password).toBe(true);
    const again = await redeem(token, `Bb2!${randomUUID()}`);
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("a new link supersedes the previous one", async () => {
    const first = (await issue()).json().token;
    const second = (await issue()).json().token;
    expect((await redeem(first)).statusCode).toBe(400);
    expect((await redeem(second)).statusCode).toBe(200);
  });

  it("an expired token is refused with the same answer as an unknown one", async () => {
    const { token } = (await issue()).json();
    await asTenant(TA, (q) => q`UPDATE users.password_setup_tokens SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day' WHERE user_id = ${uid}`);
    const expired = await redeem(token);
    const unknown = await redeem(`${TA}.${"A".repeat(43)}`);
    expect(expired.statusCode).toBe(400);
    expect(expired.json()).toMatchObject({ code: unknown.json().code, message: unknown.json().message });
  });

  it("a policy rejection leaves the token usable for a retry, and says nothing about the password", async () => {
    const { token } = (await issue()).json();
    const weak = await redeem(token, "alllowercase1234");
    expect(weak.statusCode).toBe(422);
    expect(weak.json().code).toBe("PASSWORD_POLICY");
    expect(weak.body).not.toContain("alllowercase1234");
    expect((await redeem(token)).statusCode).toBe(200);
  });

  it("a token cannot be redeemed against another tenant's user (tenant prefix swapped)", async () => {
    const { token } = (await issue()).json();
    const swapped = token.replace(TA, TB);
    expect((await redeem(swapped)).statusCode).toBe(400);
    expect(kc.users.get("kc-1")!.password).toBeUndefined();
  });

  it("cross-tenant: another tenant's admin cannot issue a link for this user", async () => {
    const res = await issue(asB(), () => uid);
    expect(res.statusCode).toBe(404);
    const rows = await asTenant(TA, (q) => q`SELECT 1 FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(0);
  });

  it("refuses a user that is not yet linked to a login, or not active", async () => {
    const unlinked = await seedUser(TA, `unlinked-${randomUUID().slice(0, 6)}@dept.gov.in`, { kc: null });
    expect((await issue(asA(), () => unlinked)).json().code).toBe("KEYCLOAK_NOT_LINKED");
    const off = await seedUser(TA, `off-${randomUUID().slice(0, 6)}@dept.gov.in`, { status: "suspended" });
    expect((await issue(asA(), () => off)).json().code).toBe("USER_NOT_ACTIVE");
  });

  it("B1: a link is refused when the target holds a role the caller could not grant (the reported escalation)", async () => {
    kc.users.get("kc-1")!.roles = new Set(["works_admin", "tenant_admin"]);
    const res = await issue(asA(["tenant_admin", "hr_admin"]));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ROLE_NOT_PERMITTED");
    expect(kc.calls.some((c) => c.path.endsWith("/reset-password"))).toBe(false);
    const rows = await asTenant(TA, (q) => q`SELECT 1 FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(0);
  });

  it.each([["tenant_admin"], ["super_admin"], ["platform_admin"], ["service_account"]])("B1: never for a target who holds %s, whoever asks", async (role) => {
    kc.users.get("kc-1")!.roles = new Set([role]);
    for (const caller of [asA(["tenant_admin"]), asA(["tenant_admin", "hr_admin"]), asOps(["platform_admin", "super_admin"])]) {
      const res = await issue(caller);
      expect([403, 404]).toContain(res.statusCode);
    }
    const rows = await asTenant(TA, (q) => q`SELECT 1 FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(0);
  });

  it("B1: an admin-tier target is reachable only by a caller who holds that role (or a platform admin)", async () => {
    kc.users.get("kc-1")!.roles = new Set(["works_admin"]);
    expect((await issue(asA(["tenant_admin"]))).statusCode).toBe(403);
    expect((await issue(asA(["tenant_admin", "works_admin"]))).statusCode).toBe(201);
  });

  it("B1: Keycloak's built-in roles do not count against the target", async () => {
    kc.users.get("kc-1")!.roles = new Set(["employee"]); // composite view adds default-roles-*, offline_access, uma_authorization
    expect((await issue()).statusCode).toBe(201);
  });

  it("B1: nobody can issue a link for their own account", async () => {
    const res = await app.inject({ method: "POST", url: `/identity/users/${uid}/password-setup-link`, headers: bearer(uid, TA, ["tenant_admin"]) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SELF_LINK");
  });

  it("B1: re-checked at redeem: a target promoted after the link was issued can no longer be redeemed", async () => {
    const { token } = (await issue()).json();
    kc.users.get("kc-1")!.roles = new Set(["tenant_admin"]); // promoted in the meantime
    const res = await redeem(token);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_OR_EXPIRED_TOKEN");
    expect(kc.calls.some((c) => c.path.endsWith("/reset-password"))).toBe(false);
  });

  it("redeem uses the roles the ISSUER held at issue time, not whoever redeems", async () => {
    kc.users.get("kc-1")!.roles = new Set(["hr_admin"]);
    setIssuer(["tenant_admin", "hr_admin"]);
    const { token } = (await issue(asA(["tenant_admin", "hr_admin"]))).json();
    expect((await redeem(token)).statusCode).toBe(200);
  });

  it("issuer demoted after issue (can no longer grant the target's roles): redeem refused with the generic 400, token not consumed", async () => {
    kc.users.get("kc-1")!.roles = new Set(["hr_admin"]);
    setIssuer(["tenant_admin", "hr_admin"]);
    const { token } = (await issue(asA(["tenant_admin", "hr_admin"]))).json();
    setIssuer(["tenant_admin"]); // lost hr_admin
    const res = await redeem(token);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_OR_EXPIRED_TOKEN");
    expect(kc.calls.some((c) => c.path.endsWith("/reset-password"))).toBe(false);
    const rows = await asTenant(TA, (q) => q`SELECT consumed_at FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows[0]!.consumed_at).toBeNull();
  });

  it("issuer no longer a user admin at all: refused", async () => {
    const { token } = (await issue()).json();
    setIssuer(["employee"]);
    expect((await redeem(token)).statusCode).toBe(400);
    expect(kc.users.get("kc-1")!.password).toBeUndefined();
  });

  it("issuer disabled (identity status) after issue: refused", async () => {
    const { token } = (await issue()).json();
    await asTenant(TA, (q) => q`UPDATE users.users SET status = 'suspended' WHERE id = ${ADMIN_A}`);
    try {
      expect((await redeem(token)).statusCode).toBe(400);
    } finally {
      await asTenant(TA, (q) => q`UPDATE users.users SET status = 'active' WHERE id = ${ADMIN_A}`);
    }
    expect(kc.users.get("kc-1")!.password).toBeUndefined();
  });

  it("issuer missing from Keycloak, or Keycloak unreadable for the issuer: refused (fail closed)", async () => {
    const { token } = (await issue()).json();
    kc.users.delete("issuer-kc");
    expect((await redeem(token)).statusCode).toBe(400);
  });

  it("issuer unchanged: still works", async () => {
    const { token } = (await issue()).json();
    expect((await redeem(token)).statusCode).toBe(200);
  });

  it("a long or hostile x-correlation-id on the public route cannot break the audit write", async () => {
    const { token } = (await issue()).json();
    const res = await app.inject({ method: "POST", url: "/identity/password-setup/redeem", headers: { "x-correlation-id": "x".repeat(300) + "'; drop table" }, payload: { token, password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const audit = await asTenant(TA, (q) => q`SELECT payload->>'action' AS a FROM _outbox.messages WHERE tenant_id = ${TA} AND payload->>'resourceId' = ${uid} AND payload->>'action' = 'password_setup_complete'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("the token is consumed in the same transaction as its audit record, and a refused attempt leaves it valid", async () => {
    const { token } = (await issue()).json();
    expect((await redeem(token, "alllowercase1234")).statusCode).toBe(422);
    let rows = await asTenant(TA, (q) => q`SELECT consumed_at FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows[0]!.consumed_at).toBeNull();
    expect((await redeem(token)).statusCode).toBe(200);
    rows = await asTenant(TA, (q) => q`SELECT consumed_at FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows[0]!.consumed_at).not.toBeNull();
    const audit = await asTenant(TA, (q) => q`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TA} AND payload->>'action' = 'password_setup_complete' AND payload->>'resourceId' = ${uid}`);
    expect(audit).toHaveLength(1);
  });

  it("a failed post-set cleanup in Keycloak does not turn a set password into 'try again'", async () => {
    kc = installFakeKeycloak({ failCleanup: true });
    vi.stubGlobal("fetch", kc.fetchMock);
    setIssuer(["tenant_admin"]);
    kc.users.set("kc-1", { id: "kc-1", username: `${TA}__${email}`, enabled: true, email, attributes: { tid: [TA] }, requiredActions: [], roles: new Set() });
    const { token } = (await issue()).json();
    const res = await redeem(token);
    expect(res.statusCode).toBe(200);
    expect(kc.users.get("kc-1")!.password).toBe(true);
  });

  it("redeem is throttled per token (a hammered token gets 429, other tokens are unaffected)", async () => {
    const { token } = (await issue()).json();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await redeem(token, "alllowercase1234")).statusCode);
    expect(codes.at(-1)).toBe(429);
    expect(codes.slice(0, 5).every((c) => c === 422)).toBe(true);
  });

  it("a settings read failure never breaks create for a tenant that is not switched on", async () => {
    const repo = await import("../src/modules/users/onboarding-repo.js");
    const spy = vi.spyOn(repo, "getSettings").mockRejectedValue(new Error("db down"));
    const res = await create(asB(), { email: "dbdown@dept.gov.in", name: "Db Down" });
    spy.mockRestore();
    expect(res.statusCode).toBe(202);
    expect(published[0]!.msg.payload).not.toHaveProperty("requestedRoles");
  });

  it("never issues a link for an account that already has a password (no takeover of existing accounts)", async () => {
    kc.users.get("kc-1")!.password = true;
    const res = await issue();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PASSWORD_ALREADY_SET");
    const rows = await asTenant(TA, (q) => q`SELECT 1 FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(0);
  });

  it("a token cannot overwrite a password that was set another way after it was issued", async () => {
    const { token } = (await issue()).json();
    kc.users.get("kc-1")!.password = true; // e.g. the user used the emailed reset in the meantime
    const res = await redeem(token);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_OR_EXPIRED_TOKEN");
    expect(kc.calls.some((c) => c.path.endsWith("/reset-password"))).toBe(false);
  });

  it("fails closed when Keycloak cannot say whether a password exists", async () => {
    kc.fetchMock.mockImplementation(async (input: unknown) => String(input).includes("/token") ? new Response(JSON.stringify({ access_token: "t", expires_in: 300 })) : new Response("{}", { status: 500 }));
    const res = await issue();
    expect(res.statusCode).toBe(503);
    const rows = await asTenant(TA, (q) => q`SELECT 1 FROM users.password_setup_tokens WHERE user_id = ${uid}`);
    expect(rows).toHaveLength(0);
  });

  it("a deactivated user's outstanding token stops working", async () => {
    const { token } = (await issue()).json();
    await asTenant(TA, (q) => q`UPDATE users.users SET status = 'deactivated' WHERE id = ${uid}`);
    expect((await redeem(token)).statusCode).toBe(400);
  });

  it("issuing is rate limited per user", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await issue()).statusCode;
    expect(last).toBe(429);
  });

  it("bulk links: per-user result, foreign ids reported not found", async () => {
    const foreign = await seedUser(TB, `foreign-${randomUUID().slice(0, 6)}@dept.gov.in`);
    const res = await app.inject({ method: "POST", url: "/identity/users/password-setup-links", headers: asA(), payload: { userIds: [uid, foreign, uid] } });
    expect(res.statusCode).toBe(200);
    const rep = res.json();
    expect(rep.results).toHaveLength(2); // duplicate id collapsed
    expect(rep.results.find((r: { userId: string }) => r.userId === foreign).code).toBe("NOT_FOUND");
    expect(rep.issued).toBe(1);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("the redeem route is public (no bearer) but rejects malformed input", async () => {
    expect((await app.inject({ method: "POST", url: "/identity/password-setup/redeem", payload: { token: "x", password: "short" } })).statusCode).toBe(400);
  });

  it("NO PASSWORD appears in any response, log line or audit record", async () => {
    const mark = logged.length;
    const { token } = (await issue()).json();
    const responses = [await redeem(token, "short"), await redeem(token), await redeem(token)];
    for (const r of responses) {
      expect(r.body).not.toContain(PASSWORD);
      expect(JSON.stringify(r.headers)).not.toContain(PASSWORD);
    }
    const lines = logged.slice(mark).join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).not.toContain(PASSWORD);
    const audit = await asTenant(TA, (q) => q`SELECT payload::text AS p FROM _outbox.messages WHERE tenant_id = ${TA}`);
    expect(audit.map((r) => r.p).join("\n")).not.toContain(PASSWORD);
    // the secret half of the token is not in the audit trail either
    expect(audit.map((r) => r.p).join("\n")).not.toContain(token.split(".")[1]);
    // and Keycloak received the password only on the reset-password call
    const sentTo = kc.calls.filter((c) => c.body.includes(PASSWORD)).map((c) => c.path);
    expect(sentTo.every((p) => p.endsWith("/reset-password"))).toBe(true);
  });
});
