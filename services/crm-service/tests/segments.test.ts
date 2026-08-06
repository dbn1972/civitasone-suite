/**
 * G5 — segment taxonomy HTTP surface.
 *
 * Round-trips through the real route → bus → consumer path: a 202 that leaves nothing
 * on disk is the CQRS failure mode this asserts against. Every endpoint is covered for
 * happy path + 400 + 401 + 403 + 404 (where a 404 is reachable), plus the things that
 * are easy to get wrong: canonical immutability, optimistic locking, and the fact that
 * only PUBLISHED segments answer on the eligibility seam.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { RESOURCE, SETTINGS_RESOURCE } from "../src/modules/segments/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-seg" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function call(
  method: Method,
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

/** The in-memory bus swallows handler failures into a DLQ; surface them on assertion. */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? []).map(
    (d) => `${d.topic}: ${d.error}`,
  );
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

interface StoredSegment {
  segmentCode: string;
  displayName: string;
  governance: string;
  status: string;
  priorityProducts: string[];
  primaryChannels: string[];
  versionNumber: number;
  version: number;
  publishedAt: Date | null;
  deprecatedAt: Date | null;
  deletedAt: Date | null;
}

async function inDb(tenantId: string, segmentCode: string): Promise<StoredSegment | undefined> {
  const rows = (await scoped(
    tenantId,
    (tx) => tx`
      SELECT segment_code AS "segmentCode", display_name AS "displayName", governance, status,
             priority_products AS "priorityProducts", primary_channels AS "primaryChannels",
             version_number AS "versionNumber", version,
             published_at AS "publishedAt", deprecated_at AS "deprecatedAt", deleted_at AS "deletedAt"
      FROM crm.segment_definitions
      WHERE tenant_id = ${tenantId} AND segment_code = ${segmentCode}
    `,
  )) as unknown as StoredSegment[];
  return rows[0];
}

/** Create a segment through the API and assert it landed. Returns its live version. */
async function createSegment(
  segmentCode: string,
  body: Record<string, unknown> = {},
  tenantId = TENANT,
): Promise<number> {
  const res = await call("POST", "/v1/crm/segments", {
    headers: headers(["crm_admin"], tenantId),
    payload: {
      segmentCode,
      displayName: `${segmentCode} display`,
      priorityProducts: ["PARCEL_EXPRESS", "LOGISTICS_POST"],
      primaryChannels: ["email", "telephony"],
      ...body,
    },
  });
  expect(res.statusCode, `create ${segmentCode}: ${res.body}`).toBe(202);
  const stored = await inDb(tenantId, segmentCode);
  expect(stored, `202 with no row on disk is a silent write failure; dlq=${JSON.stringify(dlqErrors())}`).toBeDefined();
  return stored!.version;
}

async function publishSegment(segmentCode: string, tenantId = TENANT): Promise<void> {
  const res = await call("POST", `/v1/crm/segments/${segmentCode}/publish`, {
    headers: headers(["crm_admin"], tenantId),
  });
  expect(res.statusCode, res.body).toBe(202);
  expect((await inDb(tenantId, segmentCode))?.status).toBe("published");
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.segment_definitions WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.segment_settings WHERE tenant_id = ${t}`);
    await cache.invalidateResource(t, RESOURCE);
    await cache.invalidateResource(t, SETTINGS_RESOURCE);
  }
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

// ── POST /v1/crm/segments ──────────────────────────────────────────────────────

describe("POST /v1/crm/segments", () => {
  it("creates a DRAFT segment with its ordered priority products and channels", async () => {
    await createSegment("CREATE_OK");
    const stored = await inDb(TENANT, "CREATE_OK");
    expect(stored?.status).toBe("draft");
    expect(stored?.governance).toBe("tenant");
    expect(stored?.priorityProducts).toEqual(["PARCEL_EXPRESS", "LOGISTICS_POST"]);
    expect(stored?.primaryChannels).toEqual(["email", "telephony"]);
    expect(stored?.publishedAt).toBeNull();
  });

  it("defaults products and channels to empty arrays", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "CREATE_MINIMAL", displayName: "Minimal" },
    });
    expect(res.statusCode).toBe(202);
    const stored = await inDb(TENANT, "CREATE_MINIMAL");
    expect(stored?.priorityProducts).toEqual([]);
    expect(stored?.primaryChannels).toEqual([]);
  });

  it("accepts governance=canonical so a deployment's seeding tool can install reference data", async () => {
    await createSegment("CREATE_CANONICAL", { governance: "canonical" });
    expect((await inDb(TENANT, "CREATE_CANONICAL"))?.governance).toBe("canonical");
  });

  it("returns 409 when the segmentCode already exists", async () => {
    await createSegment("CREATE_DUPE");
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "CREATE_DUPE", displayName: "Again" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SEGMENT_EXISTS");
  });

  it("returns 400 for a malformed segmentCode", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "has space", displayName: "Bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when displayName is missing", async () => {
    const res = await call("POST", "/v1/crm/segments", { payload: { segmentCode: "NO_NAME" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a channel outside the service's channel vocabulary", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "BAD_CHANNEL", displayName: "Bad channel", primaryChannels: ["sms"] },
    });
    expect(res.statusCode).toBe(400);
    expect(await inDb(TENANT, "BAD_CHANNEL")).toBeUndefined();
  });

  it("returns 400 for a repeated channel", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      payload: {
        segmentCode: "DUPE_CHANNEL",
        displayName: "Dupe channel",
        primaryChannels: ["email", "email"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a repeated priority product — priority order must be unambiguous", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "DUPE_PRODUCT", displayName: "Dupe", priorityProducts: ["A", "A"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      noAuth: true,
      payload: { segmentCode: "NO_AUTH", displayName: "No auth" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      headers: headers(["citizen"]),
      payload: { segmentCode: "FORBIDDEN_ROLE", displayName: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a plain crm_user — the taxonomy is governance", async () => {
    const res = await call("POST", "/v1/crm/segments", {
      headers: headers(["crm_user"]),
      payload: { segmentCode: "USER_ROLE", displayName: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/crm/segments ───────────────────────────────────────────────────────

describe("GET /v1/crm/segments", () => {
  it("returns the standard pagination envelope", async () => {
    await createSegment("LIST_ONE");
    const res = await call("GET", "/v1/crm/segments?page=1&pageSize=200");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ segmentCode: string }>; meta: { page: number; pageSize: number; total: number } };
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(200);
    expect(body.meta.total).toBeGreaterThan(0);
    expect(body.data.map((s) => s.segmentCode)).toContain("LIST_ONE");
  });

  it("filters by status", async () => {
    await createSegment("LIST_DRAFT");
    await createSegment("LIST_PUBLISHED");
    await publishSegment("LIST_PUBLISHED");
    const res = await call("GET", "/v1/crm/segments?status=published&pageSize=200");
    const codes = (res.json() as { data: Array<{ segmentCode: string }> }).data.map((s) => s.segmentCode);
    expect(codes).toContain("LIST_PUBLISHED");
    expect(codes).not.toContain("LIST_DRAFT");
  });

  it("filters by governance", async () => {
    await createSegment("LIST_TENANT_GOV");
    await createSegment("LIST_CANON_GOV", { governance: "canonical" });
    const res = await call("GET", "/v1/crm/segments?governance=canonical&pageSize=200");
    const codes = (res.json() as { data: Array<{ segmentCode: string }> }).data.map((s) => s.segmentCode);
    expect(codes).toContain("LIST_CANON_GOV");
    expect(codes).not.toContain("LIST_TENANT_GOV");
  });

  it("allows a plain crm_user — the UI segment picker needs it", async () => {
    const res = await call("GET", "/v1/crm/segments", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for an out-of-range pageSize", async () => {
    const res = await call("GET", "/v1/crm/segments?pageSize=500");
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an unknown status filter", async () => {
    const res = await call("GET", "/v1/crm/segments?status=retired");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/segments", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/segments", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("does not show one tenant's taxonomy to another", async () => {
    await createSegment("LIST_ISOLATION");
    const res = await call("GET", "/v1/crm/segments?pageSize=200", {
      headers: headers(["crm_admin"], OTHER),
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ segmentCode: string }> }).data.map((s) => s.segmentCode);
    expect(codes).not.toContain("LIST_ISOLATION");
  });
});

// ── GET /v1/crm/segments/:segmentCode ──────────────────────────────────────────

describe("GET /v1/crm/segments/:segmentCode", () => {
  it("returns the definition (happy path)", async () => {
    await createSegment("GET_ONE");
    const res = await call("GET", "/v1/crm/segments/GET_ONE");
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { segmentCode: string; priorityProducts: string[]; version: number } }).data;
    expect(data.segmentCode).toBe("GET_ONE");
    expect(data.priorityProducts).toEqual(["PARCEL_EXPRESS", "LOGISTICS_POST"]);
    expect(data.version).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("GET", "/v1/crm/segments/NOT_THERE");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("SEGMENT_NOT_FOUND");
  });

  it("returns 400 for a malformed code", async () => {
    const res = await call("GET", "/v1/crm/segments/x");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/segments/GET_ONE", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/segments/GET_ONE", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 across tenants — one tenant cannot read another's segment", async () => {
    await createSegment("GET_ISOLATION");
    const res = await call("GET", "/v1/crm/segments/GET_ISOLATION", {
      headers: headers(["crm_admin"], OTHER),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /v1/crm/segments/:segmentCode ────────────────────────────────────────

describe("PATCH /v1/crm/segments/:segmentCode", () => {
  it("amends the definition and bumps version (round-trip through the consumer)", async () => {
    const version = await createSegment("PATCH_OK");
    const res = await call("PATCH", "/v1/crm/segments/PATCH_OK", {
      payload: {
        displayName: "Renamed",
        priorityProducts: ["NEW_FIRST", "NEW_SECOND", "NEW_THIRD"],
        primaryChannels: ["whatsapp"],
        version,
      },
    });
    expect(res.statusCode).toBe(202);
    const stored = await inDb(TENANT, "PATCH_OK");
    expect(stored?.displayName).toBe("Renamed");
    expect(stored?.priorityProducts).toEqual(["NEW_FIRST", "NEW_SECOND", "NEW_THIRD"]);
    expect(stored?.primaryChannels).toEqual(["whatsapp"]);
    expect(stored?.version).toBe(version + 1);
  });

  it("leaves untouched fields alone", async () => {
    const version = await createSegment("PATCH_PARTIAL");
    await call("PATCH", "/v1/crm/segments/PATCH_PARTIAL", {
      payload: { displayName: "Only the name", version },
    });
    const stored = await inDb(TENANT, "PATCH_PARTIAL");
    expect(stored?.displayName).toBe("Only the name");
    expect(stored?.priorityProducts).toEqual(["PARCEL_EXPRESS", "LOGISTICS_POST"]);
  });

  it("returns 409 on a stale version and writes nothing", async () => {
    const version = await createSegment("PATCH_CONFLICT");
    const res = await call("PATCH", "/v1/crm/segments/PATCH_CONFLICT", {
      payload: { displayName: "Stale write", version: version + 5 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SEGMENT_VERSION_CONFLICT");
    expect((await inDb(TENANT, "PATCH_CONFLICT"))?.displayName).toBe("PATCH_CONFLICT display");
  });

  it("returns 422 for a canonical segment regardless of role — even super_admin", async () => {
    const version = await createSegment("PATCH_CANONICAL", { governance: "canonical" });
    const res = await call("PATCH", "/v1/crm/segments/PATCH_CANONICAL", {
      headers: headers(["super_admin"]),
      payload: { displayName: "Should not apply", version },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_CANONICAL_IMMUTABLE");
    expect((await inDb(TENANT, "PATCH_CANONICAL"))?.displayName).toBe("PATCH_CANONICAL display");
  });

  it("returns 400 when version is missing", async () => {
    await createSegment("PATCH_NO_VERSION");
    const res = await call("PATCH", "/v1/crm/segments/PATCH_NO_VERSION", {
      payload: { displayName: "No version" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when no mutable field is supplied", async () => {
    const version = await createSegment("PATCH_EMPTY");
    const res = await call("PATCH", "/v1/crm/segments/PATCH_EMPTY", { payload: { version } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an unknown channel", async () => {
    const version = await createSegment("PATCH_BAD_CHANNEL");
    const res = await call("PATCH", "/v1/crm/segments/PATCH_BAD_CHANNEL", {
      payload: { primaryChannels: ["carrier_pigeon"], version },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PATCH", "/v1/crm/segments/PATCH_OK", {
      noAuth: true,
      payload: { displayName: "x", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("PATCH", "/v1/crm/segments/PATCH_OK", {
      headers: headers(["crm_user"]),
      payload: { displayName: "x", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("PATCH", "/v1/crm/segments/NOT_THERE", {
      payload: { displayName: "x", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── POST /v1/crm/segments/:segmentCode/publish ─────────────────────────────────

describe("POST /v1/crm/segments/:segmentCode/publish", () => {
  it("publishes a draft, stamps publishedAt and bumps the taxonomy revision", async () => {
    await createSegment("PUB_OK");
    const before = await inDb(TENANT, "PUB_OK");
    await publishSegment("PUB_OK");
    const after = await inDb(TENANT, "PUB_OK");
    expect(after?.status).toBe("published");
    expect(after?.publishedAt).not.toBeNull();
    expect(after?.versionNumber).toBe((before?.versionNumber ?? 1) + 1);
  });

  it("returns 422 when already published", async () => {
    await createSegment("PUB_TWICE");
    await publishSegment("PUB_TWICE");
    const res = await call("POST", "/v1/crm/segments/PUB_TWICE/publish");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_ALREADY_PUBLISHED");
  });

  it("returns 422 for a canonical segment", async () => {
    await createSegment("PUB_CANONICAL", { governance: "canonical" });
    const res = await call("POST", "/v1/crm/segments/PUB_CANONICAL/publish");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_CANONICAL_IMMUTABLE");
  });

  it("returns 400 for a malformed code", async () => {
    const res = await call("POST", "/v1/crm/segments/x/publish");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/segments/PUB_OK/publish", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("POST", "/v1/crm/segments/PUB_OK/publish", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("POST", "/v1/crm/segments/NOT_THERE/publish");
    expect(res.statusCode).toBe(404);
  });
});

// ── POST /v1/crm/segments/:segmentCode/deprecate ───────────────────────────────

describe("POST /v1/crm/segments/:segmentCode/deprecate", () => {
  it("retires a published segment and stamps deprecatedAt", async () => {
    await createSegment("DEP_OK");
    await publishSegment("DEP_OK");
    const res = await call("POST", "/v1/crm/segments/DEP_OK/deprecate");
    expect(res.statusCode).toBe(202);
    const stored = await inDb(TENANT, "DEP_OK");
    expect(stored?.status).toBe("deprecated");
    expect(stored?.deprecatedAt).not.toBeNull();
  });

  it("can be reinstated by publishing again, which clears deprecatedAt", async () => {
    await createSegment("DEP_REINSTATE");
    await publishSegment("DEP_REINSTATE");
    await call("POST", "/v1/crm/segments/DEP_REINSTATE/deprecate");
    await publishSegment("DEP_REINSTATE");
    const stored = await inDb(TENANT, "DEP_REINSTATE");
    expect(stored?.status).toBe("published");
    expect(stored?.deprecatedAt).toBeNull();
  });

  it("returns 422 for a draft segment — only a published one can be retired", async () => {
    await createSegment("DEP_DRAFT");
    const res = await call("POST", "/v1/crm/segments/DEP_DRAFT/deprecate");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_NOT_PUBLISHED");
  });

  it("returns 422 when already deprecated", async () => {
    await createSegment("DEP_TWICE");
    await publishSegment("DEP_TWICE");
    await call("POST", "/v1/crm/segments/DEP_TWICE/deprecate");
    const res = await call("POST", "/v1/crm/segments/DEP_TWICE/deprecate");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_ALREADY_DEPRECATED");
  });

  it("returns 422 for a canonical segment", async () => {
    await createSegment("DEP_CANONICAL", { governance: "canonical" });
    const res = await call("POST", "/v1/crm/segments/DEP_CANONICAL/deprecate");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_CANONICAL_IMMUTABLE");
  });

  it("returns 400 for a malformed code", async () => {
    const res = await call("POST", "/v1/crm/segments/x/deprecate");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/segments/DEP_OK/deprecate", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("POST", "/v1/crm/segments/DEP_OK/deprecate", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("POST", "/v1/crm/segments/NOT_THERE/deprecate");
    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE /v1/crm/segments/:segmentCode ───────────────────────────────────────

describe("DELETE /v1/crm/segments/:segmentCode", () => {
  it("soft-deletes: the row survives, the segment disappears from reads", async () => {
    await createSegment("DEL_OK");
    const res = await call("DELETE", "/v1/crm/segments/DEL_OK");
    expect(res.statusCode).toBe(202);
    const stored = await inDb(TENANT, "DEL_OK");
    expect(stored, "a soft delete must not remove the row").toBeDefined();
    expect(stored?.deletedAt).not.toBeNull();
    expect((await call("GET", "/v1/crm/segments/DEL_OK")).statusCode).toBe(404);
  });

  it("keeps the code reserved — it cannot be recreated with a new meaning", async () => {
    await createSegment("DEL_RESERVED");
    await call("DELETE", "/v1/crm/segments/DEL_RESERVED");
    const res = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "DEL_RESERVED", displayName: "Different meaning" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 422 for a canonical segment", async () => {
    await createSegment("DEL_CANONICAL", { governance: "canonical" });
    const res = await call("DELETE", "/v1/crm/segments/DEL_CANONICAL");
    expect(res.statusCode).toBe(422);
    expect((await inDb(TENANT, "DEL_CANONICAL"))?.deletedAt).toBeNull();
  });

  it("returns 400 for a malformed code", async () => {
    const res = await call("DELETE", "/v1/crm/segments/x");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("DELETE", "/v1/crm/segments/DEL_OK", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("DELETE", "/v1/crm/segments/DEL_OK", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("DELETE", "/v1/crm/segments/NOT_THERE");
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /v1/crm/segments/:segmentCode/eligibility ──────────────────────────────

describe("GET /v1/crm/segments/:segmentCode/eligibility (the recommendation seam)", () => {
  it("returns priority products and primary channels in priority order for a published segment", async () => {
    await createSegment("ELIG_OK", {
      priorityProducts: ["Z_TOP_PRIORITY", "A_SECOND", "M_THIRD"],
      primaryChannels: ["whatsapp", "email"],
    });
    await publishSegment("ELIG_OK");

    const res = await call("GET", "/v1/crm/segments/ELIG_OK/eligibility");
    expect(res.statusCode).toBe(200);
    const data = (res.json() as {
      data: {
        segmentCode: string;
        displayName: string;
        status: string;
        versionNumber: number;
        priorityProducts: string[];
        primaryChannels: string[];
        publishedAt: string | null;
      };
    }).data;
    expect(data.segmentCode).toBe("ELIG_OK");
    expect(data.status).toBe("published");
    // Configured order preserved exactly — nothing alphabetises it.
    expect(data.priorityProducts).toEqual(["Z_TOP_PRIORITY", "A_SECOND", "M_THIRD"]);
    expect(data.primaryChannels).toEqual(["whatsapp", "email"]);
    expect(data.versionNumber).toBeGreaterThanOrEqual(2);
    expect(data.publishedAt).not.toBeNull();
  });

  it("exposes exactly the contract keys — a consumer can rely on the shape", async () => {
    await createSegment("ELIG_SHAPE");
    await publishSegment("ELIG_SHAPE");
    const res = await call("GET", "/v1/crm/segments/ELIG_SHAPE/eligibility");
    expect(Object.keys((res.json() as { data: Record<string, unknown> }).data).sort()).toEqual([
      "displayName",
      "primaryChannels",
      "priorityProducts",
      "publishedAt",
      "segmentCode",
      "status",
      "versionNumber",
    ]);
  });

  it("returns 404 for a DRAFT segment — a draft must not drive recommendations", async () => {
    await createSegment("ELIG_DRAFT");
    const res = await call("GET", "/v1/crm/segments/ELIG_DRAFT/eligibility");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("SEGMENT_NOT_FOUND");
  });

  it("returns 404 once a segment is deprecated — eligibility stops immediately", async () => {
    await createSegment("ELIG_DEPRECATED");
    await publishSegment("ELIG_DEPRECATED");
    expect((await call("GET", "/v1/crm/segments/ELIG_DEPRECATED/eligibility")).statusCode).toBe(200);
    await call("POST", "/v1/crm/segments/ELIG_DEPRECATED/deprecate");
    expect((await call("GET", "/v1/crm/segments/ELIG_DEPRECATED/eligibility")).statusCode).toBe(404);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await call("GET", "/v1/crm/segments/NOT_THERE/eligibility");
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a malformed code", async () => {
    const res = await call("GET", "/v1/crm/segments/x/eligibility");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/segments/ELIG_OK/eligibility", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/segments/ELIG_OK/eligibility", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 across tenants", async () => {
    await createSegment("ELIG_ISOLATION");
    await publishSegment("ELIG_ISOLATION");
    const res = await call("GET", "/v1/crm/segments/ELIG_ISOLATION/eligibility", {
      headers: headers(["crm_admin"], OTHER),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── /v1/crm/segments/settings ──────────────────────────────────────────────────

describe("GET /v1/crm/segments/settings", () => {
  it("reports enforcement OFF for a tenant with no settings row", async () => {
    const res = await call("GET", "/v1/crm/segments/settings", {
      headers: headers(["crm_admin"], OTHER),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { enforceSegmentCatalogue: boolean } }).data.enforceSegmentCatalogue).toBe(false);
  });

  it("allows a plain crm_user to read it", async () => {
    const res = await call("GET", "/v1/crm/segments/settings", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/segments/settings", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/segments/settings", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /v1/crm/segments/settings", () => {
  it("persists the switch (round-trip through the consumer) and is idempotent on replay", async () => {
    const res = await call("PUT", "/v1/crm/segments/settings", { payload: { enforceSegmentCatalogue: true } });
    expect(res.statusCode).toBe(202);
    const read = await call("GET", "/v1/crm/segments/settings");
    expect((read.json() as { data: { enforceSegmentCatalogue: boolean } }).data.enforceSegmentCatalogue).toBe(true);

    // Flip it back — the upsert must update the one row, not add a second.
    await call("PUT", "/v1/crm/segments/settings", { payload: { enforceSegmentCatalogue: false } });
    const rows = (await scoped(
      TENANT,
      (tx) => tx`SELECT enforce_segment_catalogue AS "on", version FROM crm.segment_settings WHERE tenant_id = ${TENANT}`,
    )) as unknown as Array<{ on: boolean; version: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.on).toBe(false);
    expect(rows[0]?.version).toBeGreaterThan(1);
  });

  it("returns 400 for a non-boolean value", async () => {
    const res = await call("PUT", "/v1/crm/segments/settings", { payload: { enforceSegmentCatalogue: "yes" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    const res = await call("PUT", "/v1/crm/segments/settings", { payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PUT", "/v1/crm/segments/settings", {
      noAuth: true,
      payload: { enforceSegmentCatalogue: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — enforcement is governance", async () => {
    const res = await call("PUT", "/v1/crm/segments/settings", {
      headers: headers(["crm_user"]),
      payload: { enforceSegmentCatalogue: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps one tenant's switch out of another tenant's reads", async () => {
    await call("PUT", "/v1/crm/segments/settings", { payload: { enforceSegmentCatalogue: true } });
    const res = await call("GET", "/v1/crm/segments/settings", {
      headers: headers(["crm_admin"], OTHER),
    });
    expect((res.json() as { data: { enforceSegmentCatalogue: boolean } }).data.enforceSegmentCatalogue).toBe(false);
    // Leave the tenant switch off for any later case in this file.
    await call("PUT", "/v1/crm/segments/settings", { payload: { enforceSegmentCatalogue: false } });
  });
});
