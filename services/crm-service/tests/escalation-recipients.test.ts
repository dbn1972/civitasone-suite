/**
 * GAP-CRM-ESCALATION-RULES-01 -- a lead-escalation rule must point at a real
 * recipient. A mistyped role or an unknown/inactive user id used to save cleanly
 * and the escalation then notified nobody. The route now verifies the recipient
 * against the owning services (policy-service roles, identity-service users) and
 * answers 422 INVALID_RECIPIENT -- or 503 DIRECTORY_UNAVAILABLE, failing CLOSED,
 * when it cannot verify. It also serves the editor's role + user pickers, which
 * the tenant-admin-only policy/identity list endpoints could not do for a
 * crm_admin.
 *
 * The directory lookups are stubbed (there is no policy-/identity-service in this
 * suite); the rules themselves are real DB-backed CQRS round-trips.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/directory-client.js", () => ({
  listTenantRoleNames: vi.fn(),
  listActiveTenantUsers: vi.fn(),
}));
vi.mock("../src/shared/identity-client.js", () => ({ isActiveTenantUser: vi.fn() }));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { listTenantRoleNames, listActiveTenantUsers } from "../src/shared/directory-client.js";
import { isActiveTenantUser } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const GOOD_USER = randomUUID();
const GHOST_USER = randomUUID();

function headers(roles: string[] = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-esc1" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST" | "PUT", url: string, payload?: unknown, roles?: string[]) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(roles), ...(payload === undefined ? {} : { payload }) });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function ruleCount(): Promise<number> {
  const rows = (await scoped((tx) => tx`SELECT count(*)::int AS n FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`)) as unknown as Array<{ n: number }>;
  return rows[0]!.n;
}
async function cleanup() {
  await scoped((tx) => tx`DELETE FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});
beforeEach(async () => {
  await cleanup();
  vi.mocked(listTenantRoleNames).mockReset().mockResolvedValue(["sales_manager", "lead_desk"]);
  vi.mocked(listActiveTenantUsers).mockReset().mockResolvedValue({ users: [{ id: GOOD_USER, name: "Asha Rao" }], truncated: false });
  vi.mocked(isActiveTenantUser).mockReset().mockImplementation(async (_t, id) => id === GOOD_USER);
});

const RULE = { name: "Escalate unaccepted after 1h", trigger: "unaccepted" as const, thresholdMinutes: 60 };

describe("GAP-CRM-ESCALATION-RULES-01: recipient must exist", () => {
  it("rejects an unknown recipient role with 422 INVALID_RECIPIENT and persists nothing", async () => {
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_mangaer" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT");
    expect(await ruleCount()).toBe(0);
  });

  it("accepts a role from the tenant's directory", async () => {
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_manager" });
    expect(res.statusCode).toBe(202);
    expect(await ruleCount()).toBe(1);
  });

  it("rejects an unknown / inactive recipient user with 422 and persists nothing", async () => {
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientId: GHOST_USER });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT");
    expect(isActiveTenantUser).toHaveBeenCalledWith(TENANT, GHOST_USER);
    expect(await ruleCount()).toBe(0);
  });

  it("accepts an active user of the tenant", async () => {
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientId: GOOD_USER });
    expect(res.statusCode).toBe(202);
    expect(await ruleCount()).toBe(1);
  });

  it("checks BOTH a role and a user when both are given", async () => {
    const badUser = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_manager", recipientId: GHOST_USER });
    expect(badUser.statusCode).toBe(422);
    const ok = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_manager", recipientId: GOOD_USER });
    expect(ok.statusCode).toBe(202);
  });

  it("fails CLOSED (503) when the role directory cannot be read -- the rule is not saved unverified", async () => {
    vi.mocked(listTenantRoleNames).mockResolvedValue(undefined);
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_manager" });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("DIRECTORY_UNAVAILABLE");
    expect(await ruleCount()).toBe(0);
  });

  it("fails CLOSED (503) when identity cannot confirm the user", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(undefined);
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientId: GOOD_USER });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("DIRECTORY_UNAVAILABLE");
    expect(await ruleCount()).toBe(0);
  });

  it("does not consult any directory for a rule with no recipient (e.g. reassign-only)", async () => {
    const res = await call("POST", "/v1/crm/escalation-rules", { ...RULE, thresholdMinutes: 90 });
    expect(res.statusCode).toBe(202);
    expect(listTenantRoleNames).not.toHaveBeenCalled();
    expect(isActiveTenantUser).not.toHaveBeenCalled();
  });

  it("validates on PUT as well, so an edit cannot swap in a typo", async () => {
    const created = await call("POST", "/v1/crm/escalation-rules", { ...RULE, recipientRole: "sales_manager" });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;

    const bad = await call("PUT", `/v1/crm/escalation-rules/${id}`, { ...RULE, recipientRole: "lead_dsk" });
    expect(bad.statusCode).toBe(422);
    const rows = (await scoped((tx) => tx`SELECT recipient_role FROM crm.escalation_rules WHERE id = ${id}`)) as unknown as Array<{ recipient_role: string }>;
    expect(rows[0]!.recipient_role).toBe("sales_manager");

    const good = await call("PUT", `/v1/crm/escalation-rules/${id}`, { ...RULE, recipientRole: "lead_desk" });
    expect(good.statusCode).toBe(202);
    const after = (await scoped((tx) => tx`SELECT recipient_role FROM crm.escalation_rules WHERE id = ${id}`)) as unknown as Array<{ recipient_role: string }>;
    expect(after[0]!.recipient_role).toBe("lead_desk");
  });
});

describe("GAP-CRM-ESCALATION-RULES-01: recipient pickers (GET /v1/crm/escalation-rules/recipients)", () => {
  it("serves the tenant's roles and active users to a crm_admin, with availability flags", async () => {
    const res = await call("GET", "/v1/crm/escalation-rules/recipients");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.roles).toEqual([
      { key: "sales_manager", label: "sales_manager" },
      { key: "lead_desk", label: "lead_desk" },
    ]);
    expect(body.data.users).toEqual([{ id: GOOD_USER, name: "Asha Rao" }]);
    expect(body.meta).toEqual({ rolesAvailable: true, usersAvailable: true, usersTruncated: false });
    // Only the caller's own tenant is ever asked about.
    expect(listTenantRoleNames).toHaveBeenCalledWith(TENANT);
    expect(listActiveTenantUsers).toHaveBeenCalledWith(TENANT);
  });

  it("says a directory is UNAVAILABLE (not empty) when it could not be read", async () => {
    vi.mocked(listTenantRoleNames).mockResolvedValue(undefined);
    vi.mocked(listActiveTenantUsers).mockResolvedValue(undefined);
    const res = await call("GET", "/v1/crm/escalation-rules/recipients");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ roles: [], users: [] });
    expect(res.json().meta).toEqual({ rolesAvailable: false, usersAvailable: false, usersTruncated: false });
  });

  it("flags a truncated user list", async () => {
    vi.mocked(listActiveTenantUsers).mockResolvedValue({ users: [], truncated: true });
    const res = await call("GET", "/v1/crm/escalation-rules/recipients");
    expect(res.json().meta.usersTruncated).toBe(true);
  });

  it("is admin-only: a plain crm_user is forbidden and nothing is looked up", async () => {
    const res = await call("GET", "/v1/crm/escalation-rules/recipients", undefined, ["crm_user"]);
    expect(res.statusCode).toBe(403);
    expect(listTenantRoleNames).not.toHaveBeenCalled();
    expect(listActiveTenantUsers).not.toHaveBeenCalled();
  });
});
