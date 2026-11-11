/**
 * Usable logins on create: the WORKER side (real Postgres + MemoryQueue consumers, in-memory Keycloak).
 *
 *  - switched on: attributes stamped, email set, identity row linked to the Keycloak user, default role employee,
 *    requested roles applied, first-password step per mode; no password ever sent
 *  - switched off: exactly today's chain (nothing but the bare federated user)
 *  - the worker re-checks the grant rules itself (a forged command cannot grant a platform role)
 *  - role change consumer: add/remove only allow-listed roles, grantor limits apply to removals too
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";
import { putSettings } from "../src/modules/users/onboarding-repo.js";
import { installFakeKeycloak, KC_URL } from "./helpers/fake-keycloak.js";

const T = randomUUID();
const ACTOR = randomUUID();
const wire = (q: Queue): Queue => {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
};
async function asTenant<R>(fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => { await q`SELECT set_config('app.tenant_id', ${T}, true)`; return fn(q as unknown as typeof sqlClient); })) as R;
}
async function until(cond: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error("condition not met in time");
}

let q: Queue;
let kc: ReturnType<typeof installFakeKeycloak>;

beforeAll(async () => {
  q = wire(new MemoryQueue());
  registerUserConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  vi.unstubAllEnvs();
  await asTenant(async (s) => {
    await s`DELETE FROM users.tenant_onboarding_settings WHERE tenant_id = ${T}`;
    await s`DELETE FROM users.users WHERE tenant_id = ${T}`;
  });
});
beforeEach(() => {
  vi.stubEnv("KEYCLOAK_URL", KC_URL);
  vi.stubEnv("KEYCLOAK_REALM", "civitasone");
  vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
  vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
  kc = installFakeKeycloak();
  vi.stubGlobal("fetch", kc.fetchMock);
});

async function createCmd(email: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await q.publish("identity.user.create", {
    messageId: id, type: "identity.user.create", tenantId: T, actorId: ACTOR, correlationId: `c-${id}`, schemaVersion: "1.0",
    timestamp: new Date().toISOString(),
    payload: { id, tenantId: T, email, name: "Asha Verma", empCode: null, status: "active", mfaEnabled: false, version: 1, createdBy: ACTOR, ...extra },
  } as never);
  return id;
}
const kcUser = (email: string) => kc.byName(`${T}__${email}`);
const identityRow = (id: string) => asTenant((s) => s`SELECT keycloak_user_id FROM users.users WHERE id = ${id}`);
const auditDetail = (id: string, action: string) =>
  asTenant((s) => s`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND payload->>'action' = ${action} AND payload->>'resourceId' = ${id}`);

describe("switched OFF (today's behaviour)", () => {
  it("only the bare federated user is created: no email, no profile PUT, no roles, no mail, identity link only via the old tenantVerified path", async () => {
    const email = "off@dept.gov.in";
    const id = await createCmd(email);
    await until(() => Boolean(kcUser(email)));
    await new Promise((r) => setTimeout(r, 200));
    const u = kcUser(email)!;
    expect(u.roles.size).toBe(0);
    expect(kc.calls.some((c) => c.path.includes("/role-mappings"))).toBe(false);
    expect(kc.calls.some((c) => c.path.includes("execute-actions-email"))).toBe(false);
    expect(kc.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(u.email).toBeUndefined();
    expect(await auditDetail(id, "onboarding_login_ready")).toHaveLength(0);
  });
});

describe("switched ON", () => {
  beforeAll(async () => { await putSettings(T, ACTOR, { usableLogins: true, passwordMode: "link" }, "c-setup"); });

  it("stamps the attributes, sets the email, links the identity row, gives the default employee role", async () => {
    const email = "on@dept.gov.in";
    const id = await createCmd(email, { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    const u = kcUser(email)!;
    expect(u.attributes).toMatchObject({ tenantId: [T], tid: [T], identity_user_id: [id], email_addr: [email] });
    expect(u.email).toBe(email);
    expect(u.emailVerified).toBe(true);
    expect([...u.roles]).toEqual(["employee"]);
    expect((await identityRow(id))[0]!.keycloak_user_id).toBe(u.id);
    const detail = (await auditDetail(id, "onboarding_login_ready"))[0]!.payload as { detail: Record<string, unknown> };
    expect(detail.detail).toMatchObject({ provision: "ok", attributes: "set", link: "linked", roles: expect.stringContaining("employee") });
    expect(String(detail.detail.passwordSetup)).toContain("awaiting_link");
  });

  it("with no requestedRoles at all (older producer) it still defaults to employee", async () => {
    const email = "on2@dept.gov.in";
    const id = await createCmd(email);
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect([...kcUser(email)!.roles]).toEqual(["employee"]);
  });

  it("applies the requested roles", async () => {
    const email = "mgr@dept.gov.in";
    const id = await createCmd(email, { requestedRoles: ["employee", "manager"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect([...kcUser(email)!.roles].sort()).toEqual(["employee", "manager"]);
  });

  it("re-checks the grant itself: a forged command naming a platform role grants NOTHING", async () => {
    const email = "forged@dept.gov.in";
    const id = await createCmd(email, { requestedRoles: ["employee", "super_admin"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect(kcUser(email)!.roles.size).toBe(0);
    const d = (await auditDetail(id, "onboarding_login_ready"))[0]!.payload as { detail: { rolesDenied: string[] } };
    expect(d.detail.rolesDenied).toEqual(["super_admin:PLATFORM_ROLE"]);
  });

  it("re-checks the admin-tier rule too: a grantor who does not hold hr_admin cannot grant it", async () => {
    const email = "forged2@dept.gov.in";
    const id = await createCmd(email, { requestedRoles: ["hr_admin"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect(kcUser(email)!.roles.size).toBe(0);
  });

  it("repairs a pre-existing realm user that has no tenant attributes, but never steals one that belongs to another identity user", async () => {
    const email = "pre@dept.gov.in";
    const PRE = randomUUID();
    kc.users.set(PRE, { id: PRE, username: `${T}__${email}`, enabled: true, attributes: {}, requiredActions: [], roles: new Set() });
    const id = await createCmd(email, { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect(kc.users.get(PRE)!.attributes.tid).toEqual([T]);
    expect((await identityRow(id))[0]!.keycloak_user_id).toBe(PRE);

    const email2 = "owned@dept.gov.in";
    kc.users.set("own-1", { id: "own-1", username: `${T}__${email2}`, enabled: true, attributes: { tid: [T], tenantId: [T], identity_user_id: ["someone-else"] }, requiredActions: [], roles: new Set() });
    const id2 = await createCmd(email2, { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id2, "onboarding_login_ready")).length > 0);
    expect(kc.users.get("own-1")!.attributes.identity_user_id).toEqual(["someone-else"]);
  });

  it("an email already owned by another realm user is reported, never forced", async () => {
    kc.users.set("squat", { id: "squat", username: `${randomUUID()}__dup@dept.gov.in`, email: "dup@dept.gov.in", enabled: true, attributes: {}, requiredActions: [], roles: new Set() });
    const id = await createCmd("dup@dept.gov.in", { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect(kcUser("dup@dept.gov.in")!.email).toBeUndefined();
    const d = (await auditDetail(id, "onboarding_login_ready"))[0]!.payload as { detail: { email: string } };
    expect(d.detail.email).toContain("conflict");
  });

  it("mode email: asks Keycloak to send its UPDATE_PASSWORD email; falls back to a clear audit note when mail is down", async () => {
    await putSettings(T, ACTOR, { usableLogins: true, passwordMode: "email" }, "c-email");
    const email = "mail@dept.gov.in";
    const id = await createCmd(email, { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    const mail = kc.calls.find((c) => c.path.includes("execute-actions-email"))!;
    expect(mail.body).toBe(JSON.stringify(["UPDATE_PASSWORD"]));
    expect(mail.path).toMatch(/lifespan=\d+/);
    expect(((await auditDetail(id, "onboarding_login_ready"))[0]!.payload as { detail: { passwordSetup: string } }).detail.passwordSetup).toBe("email_sent");

    kc = installFakeKeycloak({ mailWorks: false });
    vi.stubGlobal("fetch", kc.fetchMock);
    const id2 = await createCmd("nomail@dept.gov.in", { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id2, "onboarding_login_ready")).length > 0);
    const note = ((await auditDetail(id2, "onboarding_login_ready"))[0]!.payload as { detail: { passwordSetup: string } }).detail.passwordSetup;
    expect(note).toContain("email_failed");
    expect(note).toContain("link");
    await putSettings(T, ACTOR, { usableLogins: true, passwordMode: "link" }, "c-link");
  });

  it("no request the worker makes to Keycloak ever carries a password", async () => {
    const id = await createCmd("nopw@dept.gov.in", { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
    expect(kc.calls.some((c) => c.path.includes("reset-password"))).toBe(false);
    expect(kc.calls.some((c) => /"(password|credentials|value)"/.test(c.body))).toBe(false);
    expect(kc.calls.some((c) => c.body.includes("temporary"))).toBe(false);
  });
});

describe("role change consumer", () => {
  let id: string; let email: string;
  beforeEach(async () => {
    email = `chg-${randomUUID().slice(0, 6)}@dept.gov.in`;
    id = await createCmd(email, { requestedRoles: ["employee"], grantorRoles: ["tenant_admin"] });
    await until(async () => (await auditDetail(id, "onboarding_login_ready")).length > 0);
  });
  const setRoles = async (roles: string[], grantorRoles: string[]) => {
    await q.publish("identity.user.roles.set", {
      messageId: randomUUID(), type: "identity.user.roles.set", tenantId: T, actorId: ACTOR, correlationId: "c-roles", schemaVersion: "1.0", timestamp: new Date().toISOString(),
      payload: { id, roles, grantorRoles, reason: "test change" },
    } as never);
    await until(async () => (await auditDetail(id, "roles_changed")).length > 0);
    return (await auditDetail(id, "roles_changed")).at(-1)!.payload as Record<string, unknown>;
  };

  it("adds and removes allow-listed roles and audits the request and the outcome", async () => {
    const a = await setRoles(["manager"], ["tenant_admin"]);
    expect(a).toMatchObject({ outcome: "success", added: ["manager"], removed: ["employee"] });
    expect([...kcUser(email)!.roles]).toEqual(["manager"]);
    expect((await auditDetail(id, "roles_change_requested"))).toHaveLength(1);
  });

  it("leaves roles outside the allow-list alone (tenant_admin is never touched)", async () => {
    kcUser(email)!.roles.add("tenant_admin");
    await setRoles(["manager"], ["tenant_admin"]);
    expect([...kcUser(email)!.roles].sort()).toEqual(["manager", "tenant_admin"]);
  });

  it("denies a forged grant of a platform role", async () => {
    const a = await setRoles(["employee", "super_admin"], ["tenant_admin"]);
    expect(a.outcome).toBe("denied");
    expect([...kcUser(email)!.roles]).toEqual(["employee"]);
  });

  it("a grantor who may not grant hr_admin also may not REMOVE it", async () => {
    kcUser(email)!.roles.add("hr_admin");
    const a = await setRoles(["employee"], ["tenant_admin"]);
    expect(a.outcome).toBe("denied");
    expect(kcUser(email)!.roles.has("hr_admin")).toBe(true);
  });

  it("no change is a clean no-op", async () => {
    const a = await setRoles(["employee"], ["tenant_admin"]);
    expect(a).toMatchObject({ outcome: "success", note: "no change" });
  });

  it("a role missing from the realm catalog is reported, not silently counted as granted", async () => {
    const a = await setRoles(["employee", "dept_head"], ["tenant_admin"]); // dept_head is allow-listed but absent from the fake realm
    expect(String(a.reason)).toContain("dept_head");
  });
});
