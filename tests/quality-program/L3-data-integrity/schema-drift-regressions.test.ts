/**
 * L3 — Schema-drift regressions: endpoints that returned 500 because their
 * tables were never migrated.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE GUARD
 * `scripts/ci/schema-drift-guard.mjs` compares declared columns against the
 * database and would catch the table going missing again. It cannot prove the
 * endpoint actually works: a table can exist and the route still 500 for a
 * different reason (missing grant to the service role, RLS with no policy, a
 * NOT NULL the consumer does not populate). Each of those bit during this fix.
 * So the guard locks the schema and this locks the observable behaviour.
 *
 * These three were live 500s in the running fleet on 2026-07-27, one of them
 * through the gateway:
 *   GET :3025/v1/inventory/matches     -> 500 {"code":"INTERNAL"}   (money path)
 *   GET :3009/v1/contract/templates    -> 500 relation does not exist
 *   GET :3028/v1/knowledge/categories  -> 500 relation does not exist
 *
 * Also probes for raw-database leakage. contract-service and knowledge-service
 * returned the driver's message including SQLSTATE 42P01 and the internal
 * relation name, which violates the no-raw-DB-errors rule and discloses schema
 * layout.
 *
 * SCOPE OF THAT ASSERTION, STATED HONESTLY: it does not prove these services map
 * errors correctly in general. A leak only appears in an error response, and an
 * error response already fails the status assertion first. What it does prove is
 * that the response body carries no database internals, and — because it probes
 * the service port rather than the gateway — that the check is at least capable
 * of seeing a leak if one appears. Proving correct error mapping under induced
 * failure needs a fault-injection test, which is not built.
 *
 * Canary verified 2026-07-27: renaming knowledge.categories away fails 2 of the 9
 * assertions (status, and the leak check refusing to evaluate a non-200).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-0000000000aa";

function signToken(roles: string[]): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({ sub: ACTOR, tid: TENANT, roles, sid: "sess-drift", iat: now, exp: now + 3600 });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * Endpoints whose backing tables were missing.
 *
 * Each is probed BOTH through the gateway and directly at the service port. The
 * gateway replaces an upstream body with `{"code":"UPSTREAM_ERROR",...}`, so a
 * raw-Postgres-leak assertion made only against the gateway can never fail — it
 * would be theater. `upstream` is where the leak is actually observable.
 */
const DRIFT_REGRESSIONS = [
  {
    name: "inventory three-way match (payment authorisation control)",
    path: "/api/v1/inventory/matches?limit=5",
    upstream: "http://localhost:3025/v1/inventory/matches?limit=5",
    missingWas: "inventory.three_way_matches (26 columns)",
    fixedBy: "inventory-service/migrations/0014_three_way_matches.sql",
  },
  {
    name: "contract templates",
    path: "/api/v1/contract/templates?limit=5",
    upstream: "http://localhost:3009/v1/contract/templates?limit=5",
    missingWas: "templates.contract_templates + templates.template_clauses (23 columns)",
    fixedBy: "contract-service/migrations/0013_templates_schema.sql",
  },
  {
    name: "knowledge categories",
    path: "/api/v1/knowledge/categories?limit=5",
    upstream: "http://localhost:3028/v1/knowledge/categories",
    missingWas: "knowledge.categories (13 columns)",
    fixedBy: "knowledge-service/migrations/0011_missing_module_tables.sql",
  },
  {
    name: "knowledge retention policies",
    path: "/api/v1/knowledge/retention-policies?limit=5",
    upstream: "http://localhost:3028/v1/knowledge/retention-policies",
    missingWas: "knowledge.retention_policies (14 columns)",
    fixedBy: "knowledge-service/migrations/0011_missing_module_tables.sql",
  },
] as const;

/**
 * Markers that indicate a raw driver error reached the client. `42P01` is
 * undefined_table; `28P01` invalid_password; `42703` undefined_column.
 */
const RAW_DB_LEAK_MARKERS = [
  "does not exist",
  "42P01",
  "42703",
  "28P01",
  "PostgresError",
  "relation \"",
  "column \"",
];

interface Probe {
  status: number;
  body: string;
}

const results = new Map<string, Probe>();
const upstreamResults = new Map<string, Probe>();

async function probe(url: string, token: string): Promise<Probe> {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: `fetch failed: ${(e as Error).message}` };
  }
}

beforeAll(async () => {
  const token = signToken(["super_admin", "tenant_admin"]);
  for (const ep of DRIFT_REGRESSIONS) {
    results.set(ep.path, await probe(`${GATEWAY}${ep.path}`, token));
    upstreamResults.set(ep.path, await probe(ep.upstream, token));
  }
}, 30_000);

describe("L3 — Schema-drift regressions: no 500 from a missing table", () => {
  for (const ep of DRIFT_REGRESSIONS) {
    it(`${ep.name} does not 500`, () => {
      const probe = results.get(ep.path);
      expect(probe, `no probe recorded for ${ep.path}`).toBeDefined();
      if (probe === undefined) return;
      // 200 expected. 401/403 would mean the probe token is wrong, not that the
      // schema is fine, so those fail too — a green result must mean the query ran.
      expect(
        probe.status,
        `${ep.path} returned ${probe.status}. Was ${ep.missingWas} dropped or the\n` +
          `migration ${ep.fixedBy} not applied?\n  body: ${probe.body.slice(0, 300)}`,
      ).toBe(200);
    });

    it(`${ep.name} does not leak a raw database error (probed at the service, not the gateway)`, () => {
      const direct = upstreamResults.get(ep.path);
      expect(direct, `no upstream probe recorded for ${ep.upstream}`).toBeDefined();
      if (direct === undefined) return;
      expect(
        direct.status,
        `${ep.upstream} is not answering (status ${direct.status}); the leak assertion\n` +
          `below would be vacuous.\n  body: ${direct.body.slice(0, 200)}`,
      ).toBe(200);
      const leaked = RAW_DB_LEAK_MARKERS.filter((m) => direct.body.includes(m));
      expect(
        leaked,
        `${ep.upstream} leaked raw database detail to the client: ${leaked.join(", ")}\n` +
          `  body: ${direct.body.slice(0, 300)}\n` +
          `  Errors must map to { error: { code, message, correlationId } } and never\n` +
          `  expose SQLSTATE or internal relation names.`,
      ).toEqual([]);
    });
  }

  it("the probe token is accepted (otherwise the assertions above are vacuous)", () => {
    // If every response were 401, "no raw DB leak" would pass trivially. Prove
    // every probe got past auth on both paths.
    expect(results.size).toBe(DRIFT_REGRESSIONS.length);
    expect(upstreamResults.size).toBe(DRIFT_REGRESSIONS.length);
    const rejected = [...results.values(), ...upstreamResults.values()].filter(
      (b) => b.status === 401 || b.status === 403 || b.status === 0,
    );
    expect(
      rejected.map((r) => `${r.status}: ${r.body.slice(0, 80)}`),
      "a probe never reached the query — the drift assertions verified nothing",
    ).toEqual([]);
  });
});
