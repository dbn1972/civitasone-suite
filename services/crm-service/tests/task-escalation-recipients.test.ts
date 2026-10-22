/**
 * GAP-CRM-TASK-ESCALATION-01 - a task-escalation rule must name a REAL recipient.
 *
 * The editor used to take a free-text role and user id, so a mistyped value saved as
 * valid and overdue tasks escalated to nobody. The server is the authority: a rule
 * needs a recipient, a recipient role must be one of the tenant's roles, a recipient
 * user must be an active user of the tenant, and a recipient that cannot be verified
 * is refused (fail closed) rather than saved on trust.
 *
 * Also covers the staff directory behind the pickers (GET /v1/crm/directory/*), which
 * must work for CRM roles that are not platform/tenant admins.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { clearDirectoryCache } from "../src/shared/user-directory.js";

vi.mock("../src/shared/identity-client.js", () => ({ isActiveTenantUser: vi.fn() }));
import { isActiveTenantUser } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const ACTOR = randomUUID();
const MANAGER = randomUUID();

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const originalFetch = globalThis.fetch;
/** policy-service /policy/roles; null = unreachable. */
let policyRoles: Array<{ name: string; status: string }> | null;
/** identity-service /identity/users (the pickers list ACTIVE users only); null = unreachable. */
let identityUsers: Array<{ id: string; name: string; status?: string }> | null;
/** The identity requests the directory made to /identity/users/directory (the name search), newest last. */
let searchRequests: Array<{ url: string; headers: Record<string, string> }> = [];

globalThis.fetch = (async (url: unknown, init?: unknown) => {
  const u = String(url);
  if (u.includes("/policy/roles")) {
    if (policyRoles === null) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(policyRoles), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/identity/users?")) {
    if (identityUsers === null) throw new Error("connect ECONNREFUSED");
    // Honour the paging the directory asks for (limit/offset), like identity-service does.
    const q = new URL(u).searchParams;
    const offset = Number(q.get("offset") ?? 0);
    const limit = Number(q.get("limit") ?? 200);
    return new Response(JSON.stringify(identityUsers.slice(offset, offset + limit)), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/identity/users/directory?")) {
    // identity-service's shared directory type-ahead: ACTIVE users, NAME match only, at most 20 rows,
    // { id, displayName } back. Extra fields on the stored rows (email, phone, roles) are returned
    // as-is by this stub so the tests can prove crm-service never passes them on.
    searchRequests.push({ url: u, headers: ((init as { headers?: Record<string, string> } | undefined)?.headers ?? {}) });
    if (identityUsers === null) throw new Error("connect ECONNREFUSED");
    const q = new URL(u).searchParams;
    const needle = (q.get("q") ?? "").toLowerCase();
    const limit = Math.min(Number(q.get("limit") ?? 20), 20);
    const rows = identityUsers
      .filter((r) => r.status === "active" && r.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(({ name, ...rest }) => ({ ...rest, displayName: name }));
    return new Response(JSON.stringify({ data: rows }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(url as string, init as RequestInit);
}) as typeof fetch;

const app = await buildApp();

beforeEach(async () => {
  policyRoles = [
    { name: "sales_manager", status: "active" },
    { name: "regional_head", status: "active" },
    { name: "retired_role", status: "inactive" },
  ];
  identityUsers = [
    { id: MANAGER, name: "Priya Sharma", status: "active" },
    { id: ACTOR, name: "Anil Kumar", status: "active" },
  ];
  clearDirectoryCache();
  searchRequests = [];
  vi.mocked(isActiveTenantUser).mockReset();
  vi.mocked(isActiveTenantUser).mockResolvedValue(true);
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.task_escalation_rules WHERE tenant_id = ${TENANT}`;
  });
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.task_escalation_rules WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function post(payload: Record<string, unknown>, roles?: string[]) {
  return app.inject({ method: "POST", url: "/v1/crm/task-escalation-rules", headers: headers(roles), payload });
}
const rule = { name: "Escalate after a day", appliesTo: "task", thresholdMinutes: 1440 };

describe("GAP-CRM-TASK-ESCALATION-01: rule recipients are verified", () => {
  it("accepts a rule that targets a real role", async () => {
    const res = await post({ ...rule, recipientRole: "sales_manager" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.recipientRole).toBe("sales_manager");
  });

  it("accepts a rule that targets an active user, and reads the recipient back", async () => {
    const res = await post({ ...rule, recipientId: MANAGER });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(isActiveTenantUser)).toHaveBeenCalledWith(TENANT, MANAGER);
    const list = await app.inject({ method: "GET", url: "/v1/crm/task-escalation-rules", headers: headers() });
    expect(list.json().data[0]).toMatchObject({ recipientId: MANAGER, recipientRole: null });
  });

  it("refuses a mistyped / unknown role (422) and saves nothing", async () => {
    const res = await post({ ...rule, recipientRole: "sales_managr" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT_ROLE");
    const list = await app.inject({ method: "GET", url: "/v1/crm/task-escalation-rules", headers: headers() });
    expect(list.json().data).toEqual([]);
  });

  it("refuses a role that exists but is no longer active", async () => {
    expect((await post({ ...rule, recipientRole: "retired_role" })).statusCode).toBe(422);
  });

  it("refuses a user who is not an active user of this tenant (422)", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(false);
    const res = await post({ ...rule, recipientId: randomUUID() });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT");
  });

  it("refuses a rule with NO recipient at all (400) - it would escalate to nobody", async () => {
    const res = await post({ ...rule });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().fieldErrors)).toContain("recipientRole");
    expect((await post({ ...rule, recipientRole: null, recipientId: null })).statusCode).toBe(400);
  });

  it("fails CLOSED when the role directory cannot be read (503), rather than saving on trust", async () => {
    policyRoles = null;
    const res = await post({ ...rule, recipientRole: "sales_manager" });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("DIRECTORY_UNAVAILABLE");
  });

  it("fails CLOSED when identity cannot confirm the user (503)", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(undefined);
    expect((await post({ ...rule, recipientId: MANAGER })).statusCode).toBe(503);
  });

  it("verifies a recipient changed by an update, but not an untouched one", async () => {
    const created = await post({ ...rule, recipientRole: "sales_manager" });
    const id = created.json().data.id as string;

    // The role is later removed from the tenant; tuning the threshold must still work.
    policyRoles = [{ name: "regional_head", status: "active" }];
    clearDirectoryCache();
    const tune = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { thresholdMinutes: 60 } });
    expect(tune.statusCode).toBe(200);
    expect(tune.json().data.thresholdMinutes).toBe(60);

    // ...but pointing it at a role that does not exist is refused.
    const bad = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { recipientRole: "nonexistent" } });
    expect(bad.statusCode).toBe(422);
    const good = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { recipientRole: "regional_head" } });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.recipientRole).toBe("regional_head");
  });

  it("accepts the editor's full-body save of an unchanged recipient whose role has since gone", async () => {
    const id = (await post({ ...rule, recipientRole: "sales_manager" })).json().data.id as string;
    policyRoles = [{ name: "regional_head", status: "active" }];
    clearDirectoryCache();
    // The editor re-sends every field on each save; the stale-but-unchanged role must not block a
    // disable/retime (the page flags the rule; the server only vets what is being CHANGED).
    const res = await app.inject({
      method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(),
      payload: { ...rule, thresholdMinutes: 90, recipientRole: "sales_manager", recipientId: null, enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ thresholdMinutes: 90, enabled: false, recipientRole: "sales_manager" });
  });

  it("can DISABLE a rule whose manager has left (an unchanged recipient is not re-verified)", async () => {
    const id = (await post({ ...rule, recipientId: MANAGER })).json().data.id as string;
    vi.mocked(isActiveTenantUser).mockReset();
    vi.mocked(isActiveTenantUser).mockResolvedValue(false);
    const res = await app.inject({
      method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(),
      payload: { ...rule, recipientId: MANAGER, enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ enabled: false, recipientId: MANAGER });
    expect(vi.mocked(isActiveTenantUser)).not.toHaveBeenCalled();
  });

  it("can retime an ENABLED stale rule: the editor re-sends enabled: true, which is not 'enabling'", async () => {
    const id = (await post({ ...rule, recipientRole: "sales_manager" })).json().data.id as string;
    policyRoles = [{ name: "regional_head", status: "active" }];
    clearDirectoryCache();
    const res = await app.inject({
      method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(),
      payload: { ...rule, thresholdMinutes: 120, recipientRole: "sales_manager", enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.thresholdMinutes).toBe(120);
  });

  // Same rule as the lead-escalation rules (shared/recipient-changes.ts): an unchanged recipient is not
  // re-verified, EXCEPT when the rule is switched back ON, where every recipient it will have is.
  it("verifies every recipient when a disabled rule is switched back ON: a retired role cannot be re-enabled", async () => {
    const id = (await post({ ...rule, recipientRole: "sales_manager", enabled: false })).json().data.id as string;
    policyRoles = [{ name: "regional_head", status: "active" }];
    clearDirectoryCache();
    const res = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { enabled: true } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT_ROLE");
    const list = await app.inject({ method: "GET", url: "/v1/crm/task-escalation-rules", headers: headers() });
    expect(list.json().data[0]).toMatchObject({ id, enabled: false });
  });

  it("refuses to re-enable a rule whose manager has left, and allows it once the rule points at someone live", async () => {
    const id = (await post({ ...rule, recipientId: MANAGER, enabled: false })).json().data.id as string;
    vi.mocked(isActiveTenantUser).mockReset();
    vi.mocked(isActiveTenantUser).mockImplementation(async (_t, uid) => uid === ACTOR);
    const refused = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { enabled: true } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("INVALID_RECIPIENT");
    // re-pointing the rule at a live manager in the same save re-enables it
    const fixed = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { enabled: true, recipientId: ACTOR } });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().data).toMatchObject({ enabled: true, recipientId: ACTOR });
  });

  it("404s an update to a rule that does not exist (or belongs to another tenant)", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/crm/task-escalation-rules/${randomUUID()}`, headers: headers(),
      payload: { thresholdMinutes: 90 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("will not let an update clear the last recipient (422)", async () => {
    const id = (await post({ ...rule, recipientRole: "sales_manager" })).json().data.id as string;
    const res = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { recipientRole: null } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("RECIPIENT_REQUIRED");
    // Swapping the role for a user in one request is fine.
    const swap = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { recipientRole: null, recipientId: MANAGER } });
    expect(swap.statusCode).toBe(200);
  });

  it("is still admin-only", async () => {
    expect((await post({ ...rule, recipientRole: "sales_manager" }, ["crm_user"])).statusCode).toBe(403);
  });

  // The role directory is cached for 60s. A recipient check must judge a role as it is NOW
  // (the lead-escalation twin and the recipients picker both read `fresh`), so a role created
  // or retired inside that window is neither wrongly refused nor wrongly accepted.
  it("judges a role created seconds ago by the live directory, not the 60s cache (no cache clear between)", async () => {
    // Warm the 60s cache with the original role set.
    expect((await post({ ...rule, recipientRole: "sales_manager" })).statusCode).toBe(201);
    // A role is created in policy-service; the cache has NOT expired and is NOT cleared.
    policyRoles = [...(policyRoles ?? []), { name: "new_zonal_head", status: "active" }];
    const res = await post({ ...rule, recipientRole: "new_zonal_head" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.recipientRole).toBe("new_zonal_head");
  });

  it("refuses a role retired seconds ago by the live directory, not the 60s cache (no cache clear between)", async () => {
    expect((await post({ ...rule, recipientRole: "regional_head" })).statusCode).toBe(201);
    // regional_head is retired in policy-service; the cache still lists it as active.
    policyRoles = (policyRoles ?? []).map((r) => (r.name === "regional_head" ? { ...r, status: "inactive" } : r));
    const res = await post({ ...rule, recipientRole: "regional_head" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECIPIENT_ROLE");
  });
});

describe("GAP-CRM-TASK-ESCALATION-01: the staff directory behind the pickers", () => {
  async function get(url: string, roles?: string[]) {
    return app.inject({ method: "GET", url, headers: headers(roles) });
  }

  it("lists the tenant's users as id + name only, for a crm_admin who is not a tenant admin", async () => {
    const res = await get("/v1/crm/directory/users", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      { id: ACTOR, name: "Anil Kumar" },
      { id: MANAGER, name: "Priya Sharma" },
    ]);
    expect(res.json().meta).toEqual({ total: 2, truncated: false });
  });

  it("offers ACTIVE users only: a deactivated user is never a pickable assignee or manager", async () => {
    const gone = randomUUID();
    identityUsers = [
      { id: MANAGER, name: "Priya Sharma", status: "active" },
      { id: gone, name: "Retired Officer", status: "suspended" },
    ];
    clearDirectoryCache();
    const res = await get("/v1/crm/directory/users", ["crm_user"]);
    expect(res.json().data).toEqual([{ id: MANAGER, name: "Priya Sharma" }]);
    expect(res.body).not.toContain("Retired Officer");
  });

  it("says when the list is truncated, so a missing name is not read as 'no such user'", async () => {
    identityUsers = Array.from({ length: 1200 }, (_, i) => ({ id: randomUUID(), name: `Officer ${String(i).padStart(4, "0")}`, status: "active" }));
    clearDirectoryCache();
    const res = await get("/v1/crm/directory/users", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.truncated).toBe(true);
    expect(res.json().data).toHaveLength(1000);
  });

  it("also serves a plain crm_user (they reassign their own tasks) but not a non-CRM role", async () => {
    expect((await get("/v1/crm/directory/users", ["crm_user"])).statusCode).toBe(200);
    expect((await get("/v1/crm/directory/users", ["citizen"])).statusCode).toBe(403);
  });

  it("lists active roles as key + label, admin-only", async () => {
    const res = await get("/v1/crm/directory/roles", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      { key: "regional_head", label: "regional_head" },
      { key: "sales_manager", label: "sales_manager" },
    ]);
    expect((await get("/v1/crm/directory/roles", ["crm_user"])).statusCode).toBe(403);
  });

  it("answers 503 - not an empty list - when the directory is unreachable", async () => {
    identityUsers = null;
    policyRoles = null;
    clearDirectoryCache();
    expect((await get("/v1/crm/directory/users")).statusCode).toBe(503);
    expect((await get("/v1/crm/directory/roles")).statusCode).toBe(503);
  });

  it("never exposes more than id + name", async () => {
    identityUsers = [{ id: MANAGER, name: "Priya Sharma", email: "priya@example.com", status: "active" } as never];
    clearDirectoryCache();
    const res = await get("/v1/crm/directory/users");
    expect(res.json().data[0]).toEqual({ id: MANAGER, name: "Priya Sharma" });
    expect(res.body).not.toContain("priya@example.com");
  });

  // OWNER DECISION (docs/gap-ledger/crm.md): a plain crm_user may list / search every ACTIVE colleague by name.
  // The response is pinned to id + display name for every role that may call it, whatever identity sends back.
  describe("response shape: exactly { id, name } per person, for every role that may call it", () => {
    const rich = () => [
      {
        id: MANAGER, name: "Priya Sharma", status: "active",
        email: "priya@example.gov.in", phone: "+919876500001", roles: ["tenant_admin"], mfaEnabled: true, empCode: "E-1001",
      },
    ] as never;

    it.each([["crm_user"], ["crm_admin"], ["tenant_admin"], ["super_admin"]])("browse as %s", async (role) => {
      identityUsers = rich();
      clearDirectoryCache();
      const res = await get("/v1/crm/directory/users", [role]);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([{ id: MANAGER, name: "Priya Sharma" }]);
      expect(Object.keys(res.json().data[0]).sort()).toEqual(["id", "name"]);
      for (const leaked of ["priya@example.gov.in", "9876500001", "tenant_admin", "mfaEnabled", "E-1001", "status"]) {
        expect(res.body).not.toContain(leaked);
      }
    });

    it.each([["crm_user"], ["crm_admin"]])("search as %s", async (role) => {
      identityUsers = rich();
      const res = await get("/v1/crm/directory/users?q=priya", [role]);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([{ id: MANAGER, name: "Priya Sharma" }]);
      expect(Object.keys(res.json().data[0]).sort()).toEqual(["id", "name"]);
      for (const leaked of ["priya@example.gov.in", "9876500001", "tenant_admin", "mfaEnabled", "E-1001", "displayName"]) {
        expect(res.body).not.toContain(leaked);
      }
    });
  });

  // GAP-CRM-TASK-ESCALATION-01 review: the plain list is bounded (1000 rows, flagged `truncated`), so on a
  // large tenant some people are not in it. `?q=` searches by name on the server and reaches them.
  describe("?q= server-side name search reaches users beyond the browse bound", () => {
    function bigTenant(): string {
      identityUsers = Array.from({ length: 1200 }, (_, i) => ({ id: randomUUID(), name: `Officer ${String(i).padStart(4, "0")}`, status: "active" }));
      clearDirectoryCache();
      return identityUsers[1150]!.id;
    }

    it("finds a user the truncated plain list leaves out", async () => {
      const lateId = bigTenant();
      const plain = await get("/v1/crm/directory/users", ["crm_admin"]);
      expect(plain.json().meta.truncated).toBe(true);
      expect((plain.json().data as Array<{ id: string }>).some((u) => u.id === lateId)).toBe(false);

      const found = await get("/v1/crm/directory/users?q=Officer%201150", ["crm_admin"]);
      expect(found.statusCode).toBe(200);
      expect(found.json().data).toEqual([{ id: lateId, name: "Officer 1150" }]);
      expect(found.json().meta).toEqual({ total: 1, truncated: false, query: "Officer 1150", searchLimit: 20 });
    });

    it("asks identity as the CALLER's tenant over the internal path, with the query encoded", async () => {
      bigTenant();
      await get("/v1/crm/directory/users?q=Officer%201150", ["crm_user"]);
      expect(searchRequests).toHaveLength(1);
      const { url, headers: sent } = searchRequests[0]!;
      expect(new URL(url).pathname).toBe("/identity/users/directory");
      expect(new URL(url).searchParams.get("q")).toBe("Officer 1150");
      expect(sent["x-tenant-id"]).toBe(TENANT);
      expect(sent["x-internal"]).toBe("1");
    });

    it("says `truncated` when the match list hit its cap, so the UI asks the user to narrow the search", async () => {
      bigTenant();
      const res = await get("/v1/crm/directory/users?q=Officer", ["crm_admin"]);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(20);
      expect(res.json().meta.truncated).toBe(true);
    });

    it("offers ACTIVE users only: a deactivated match is never returned", async () => {
      identityUsers = [
        { id: MANAGER, name: "Priya Sharma", status: "active" },
        { id: randomUUID(), name: "Priya Retired", status: "suspended" },
      ];
      const res = await get("/v1/crm/directory/users?q=priya", ["crm_user"]);
      expect(res.json().data).toEqual([{ id: MANAGER, name: "Priya Sharma" }]);
      expect(res.body).not.toContain("Priya Retired");
    });

    it("returns an empty list (not an error) for a search nobody matches", async () => {
      const res = await get("/v1/crm/directory/users?q=zzzz", ["crm_admin"]);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
      expect(res.json().meta.truncated).toBe(false);
    });

    it("refuses a query shorter than 2 characters (400) instead of listing the whole tenant", async () => {
      expect((await get("/v1/crm/directory/users?q=a", ["crm_admin"])).statusCode).toBe(400);
      expect((await get("/v1/crm/directory/users?q=%20%20", ["crm_admin"])).statusCode).toBe(400);
      expect(searchRequests).toHaveLength(0);
    });

    it("fails closed: 503 when identity cannot be read, never an empty result presented as fact", async () => {
      identityUsers = null;
      expect((await get("/v1/crm/directory/users?q=priya", ["crm_admin"])).statusCode).toBe(503);
    });

    it("has the same access as the plain list: crm_user may search, a non-CRM role may not", async () => {
      expect((await get("/v1/crm/directory/users?q=priya", ["crm_user"])).statusCode).toBe(200);
      expect((await get("/v1/crm/directory/users?q=priya", ["citizen"])).statusCode).toBe(403);
      expect(searchRequests).toHaveLength(1);
    });
  });
});
