/**
 * GAP-ANALYTICS-SF-17b: dashboards carry only `owner_id` (an identity-provider
 * actor id). The web showed `ownerId.slice(0, 8)`. analytics-service now resolves
 * the owner's name through hrms-service (tenant-scoped, batched, display-only) and
 * returns `ownerName`; null when the actor is not a linked employee of THIS tenant.
 *
 * Real analytics Postgres (analytics_svc, FORCE RLS). hrms is faked only at its
 * HTTP boundary (tenant-aware stand-in for /v1/hrms/internal/employee-summaries).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";

const PORT = 53919;
vi.hoisted(() => {
  process.env.HRMS_SERVICE_URL = "http://127.0.0.1:53919";
  process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
});

import { sqlClient } from "../src/shared/db.js";
import { listDashboards } from "../src/modules/dashboards/queries.js";
import { resolveActorNames } from "../src/shared/hrms-client.js";

const TENANT = "beef0000-0000-4000-8000-00000017b201";
const OTHER = "beef0000-0000-4000-8000-00000017b202";
const ACTOR = "beef0000-0000-4000-8000-00000017b2a0";
const OWNER_OK = "beef0000-0000-4000-a000-00000017b2f1";
const OWNER_UNLINKED = "beef0000-0000-4000-a000-00000017b2f2";
const OWNER_OTHER_TENANT = "beef0000-0000-4000-a000-00000017b2f3";

const hrmsData: Record<string, Array<{ id: string; fullName: string; userRef: string }>> = {
  [TENANT]: [{ id: "beef0000-0000-4000-9000-00000017b2e1", fullName: "Asha Rao", userRef: OWNER_OK }],
  [OTHER]: [{ id: "beef0000-0000-4000-9000-00000017b2e3", fullName: "Foreign Tenant Person", userRef: OWNER_OTHER_TENANT }],
};
const requests: string[] = [];
let server: Server;

function startFakeHrms(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push(url.pathname + url.search);
    const tenant = String(req.headers["x-tenant-id"] ?? "");
    if (req.headers["x-internal"] !== "1" || req.headers["x-service-secret"] !== process.env.INTERNAL_SERVICE_SECRET) {
      res.statusCode = 401; res.end("{}"); return;
    }
    const wanted = new Set((url.searchParams.get("actorIds") ?? "").split(",").filter(Boolean));
    const rows = (hrmsData[tenant] ?? []).filter((r) => wanted.has(r.userRef));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(rows.map((r) => ({ ...r, employeeNo: "E", departmentName: "BI" }))));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}

/** The request-scoped tenant context the HTTP layer establishes (FORCE RLS reads need it). */
const inTenant = <T,>(t: string, fn: () => Promise<T>): Promise<T> => runWithTenant(t, fn);
const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) await asT(t, (tx) => tx`DELETE FROM analytics.dashboards WHERE tenant_id = ${t}`);
}

beforeAll(async () => {
  await startFakeHrms();
  await cleanup();
  await asT(TENANT, async (tx) => {
    for (const [name, owner] of [["Mine", OWNER_OK], ["Unlinked", OWNER_UNLINKED], ["Crossed", OWNER_OTHER_TENANT]] as const) {
      await tx`INSERT INTO analytics.dashboards (tenant_id, name, owner_id, visibility, created_by, updated_by) VALUES (${TENANT}, ${name}, ${owner}, 'shared', ${ACTOR}, ${ACTOR})`;
    }
    await tx`INSERT INTO analytics.dashboards (tenant_id, name, owner_id, created_by, updated_by) VALUES (${TENANT}, 'Ownerless', NULL, ${ACTOR}, ${ACTOR})`;
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await new Promise<void>((r) => server.close(() => r()));
  await sqlClient.end();
});

describe("SF-17b analytics owner names (real DB, tenant-aware hrms boundary)", () => {
  it("names the owner; unlinked, other-tenant and missing owners come back null (never an id)", async () => {
    const page = await inTenant(TENANT, () => listDashboards(TENANT, 50, 0));
    const byName = new Map(page.data.map((d) => [d.name, d]));
    expect(byName.get("Mine")?.ownerName).toBe("Asha Rao");
    expect(byName.get("Unlinked")?.ownerName).toBeNull();
    expect(byName.get("Crossed")?.ownerName).toBeNull();
    expect(byName.get("Ownerless")?.ownerName).toBeNull();
    expect(JSON.stringify(page)).not.toContain("Foreign Tenant Person");
  });

  it("one batched, actor-filtered request per page, never the whole directory", async () => {
    requests.length = 0;
    await inTenant(TENANT, () => listDashboards(TENANT, 50, 0));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("actorIds=");
  });

  it("makes no hrms request when no row has an owner, and ignores malformed ids", async () => {
    requests.length = 0;
    expect((await resolveActorNames(TENANT, [null, undefined, "nope"])).size).toBe(0);
    expect(requests).toEqual([]);
  });

  it("fails open: an hrms outage yields no names, not an error", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const out = await resolveActorNames(TENANT, [OWNER_OK]);
    expect(out.size).toBe(0);
    await startFakeHrms();
  });
});
