/**
 * GAP-CRM-AGENT-WORKLOAD-05 -- GET /v1/crm/teams/agents returns each agent's display
 * name. crm.agent_workload stores only the agent id, so every roster row rendered as
 * "Unnamed agent"; the route now resolves names from identity-service's internal
 * user-summaries lookup. An unresolved or unreachable lookup yields rows WITHOUT a
 * `name` (the UI shows a neutral label) -- never the raw agent id in its place.
 *
 * The app is driven in-process (inject); only the identity fetch is stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { clearDirectoryCache } from "../src/shared/user-directory.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const KNOWN_AGENT = randomUUID();
const UNKNOWN_AGENT = randomUUID();
const realFetch = globalThis.fetch;

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function agents() {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/crm/teams/agents",
    headers: {
      authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_user"], sid: "sess-w05" }, SECRET)}`,
      "x-tenant-id": TENANT,
    },
  });
  await app.close();
  return res;
}

function stubIdentity(users: Array<{ id: string; name: string }> | "down" | 503) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/identity/internal/user-summaries")) return realFetch(input as RequestInfo, init);
    if (users === "down") throw new TypeError("connect ECONNREFUSED");
    if (users === 503) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify(users), { status: 200 });
  });
}

beforeAll(async () => {
  await scoped((tx) => tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`
    INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available, skills)
    VALUES (gen_random_uuid(), ${TENANT}, ${KNOWN_AGENT}, 50, 1, true, '[]'::jsonb),
           (gen_random_uuid(), ${TENANT}, ${UNKNOWN_AGENT}, 50, 2, true, '[]'::jsonb)`);
});
// Each case stubs a different identity directory: forget the per-tenant name cache between them.
beforeEach(() => clearDirectoryCache());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await scoped((tx) => tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`).catch(() => {});
  await sqlClient.end();
});

const byAgent = (res: Awaited<ReturnType<typeof agents>>, id: string) =>
  (res.json().data as Array<Record<string, unknown>>).find((a) => a.agentId === id)!;

describe("GET /v1/crm/teams/agents display names (GAP-CRM-AGENT-WORKLOAD-05)", () => {
  it("names each agent identity-service knows, and leaves an unknown one nameless", async () => {
    stubIdentity([{ id: KNOWN_AGENT, name: "Asha Rao" }, { id: randomUUID(), name: "Not In This Roster" }]);
    const res = await agents();
    expect(res.statusCode).toBe(200);
    expect(byAgent(res, KNOWN_AGENT)).toMatchObject({ name: "Asha Rao", maxLeads: 50, currentLoad: 1 });
    const unknown = byAgent(res, UNKNOWN_AGENT);
    expect("name" in unknown).toBe(false); // never the raw id in its place
    expect(JSON.stringify(res.json())).not.toContain("Not In This Roster"); // other users' names are not leaked
  });

  // The web agent pickers read this roster on every keystroke.
  it("fetches the directory once per minute per tenant", async () => {
    const ok = stubIdentity([{ id: KNOWN_AGENT, name: "Asha Rao" }]);
    expect(byAgent(await agents(), KNOWN_AGENT).name).toBe("Asha Rao");
    await agents();
    await agents();
    expect(ok.mock.calls.filter((c) => String(c[0]).includes("user-summaries"))).toHaveLength(1);
  });

  // A failed lookup is remembered for 10s (user-directory.ts), so while identity is down the
  // per-keystroke roster reads do not each wait out the identity timeout; after the window the
  // roster recovers by itself.
  it("remembers a failed lookup for 10s only: no refetch inside the window, names back after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
      const down = stubIdentity("down");
      expect("name" in byAgent(await agents(), KNOWN_AGENT)).toBe(false); // failed
      down.mockRestore();

      const ok = stubIdentity([{ id: KNOWN_AGENT, name: "Asha Rao" }]);
      const lookups = () => ok.mock.calls.filter((c) => String(c[0]).includes("user-summaries")).length;
      vi.setSystemTime(new Date("2026-10-21T10:00:05Z"));
      expect("name" in byAgent(await agents(), KNOWN_AGENT)).toBe(false); // inside the window: not asked again
      expect(lookups()).toBe(0);

      vi.setSystemTime(new Date("2026-10-21T10:00:11Z")); // past the 10s failure window
      expect(byAgent(await agents(), KNOWN_AGENT).name).toBe("Asha Rao"); // recovered
      await agents();
      expect(lookups()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([["unreachable", "down" as const], ["unavailable (503)", 503 as const]])(
    "still returns the roster, unnamed, when identity-service is %s",
    async (_label, mode) => {
      stubIdentity(mode);
      const res = await agents();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
      expect((res.json().data as Array<Record<string, unknown>>).every((a) => !("name" in a))).toBe(true);
    },
  );
});
