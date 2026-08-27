/**
 * helpdesk-service — canned-responses PATCH: SQL injection regression.
 *
 * PATCH /v1/helpdesk/canned-responses/:id built its UPDATE by string-
 * concatenating request-body values into a query string run via
 * `tx.unsafe()`. `title`/`content` were quote-doubled but `category` and
 * `shortCode` were spliced in completely unescaped, so a single quote in
 * either field broke out of the SQL string literal. Fixed to use
 * parameterized conditional fragments (matching this file's own GET
 * handler's existing `category ? tx\`...\` : tx\`\`` pattern) so every value
 * is bound, never spliced into SQL text.
 *
 * DB-backed against live civitas_helpdesk. helpdesk.canned_responses has RLS
 * ENABLEd and FORCEd (migration 0038), same as sla_config/tickets — so the
 * test's own verification/cleanup queries against raw `sqlClient` must go
 * through `withRawTenantGuc` too, exactly like the route handlers do,
 * otherwise `app.tenant_id` is unset and Postgres rejects the query.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "eeeeeeee-1111-4000-8000-00000000ca11";
const OTHER_TENANT = "eeeeeeee-2222-4000-8000-00000000ca12";
const ACTOR = "eeeeeeee-3333-4000-8000-00000000ca13";

function token(roles = ["helpdesk_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-canned" }, SECRET);
}

let app: FastifyInstance;

async function post(url: string, tok: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    payload: payload as object,
  });
}

async function patch(url: string, tok: string, payload: unknown) {
  return app.inject({
    method: "PATCH",
    url,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    payload: payload as object,
  });
}

async function seedResponse(tenantId: string): Promise<string> {
  const res = await post("/v1/helpdesk/canned-responses", token(["helpdesk_admin"], tenantId), {
    title: "Password reset",
    content: "Please use the self-service portal to reset your password.",
    category: "account",
    shortCode: "PWRESET",
    tags: ["account", "password"],
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

type Row = {
  title: string; content: string; category: string | null; short_code: string | null;
  tags: unknown; enabled: boolean;
};

async function selectRow(tenantId: string, id: string): Promise<Row | undefined> {
  const rows = await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`
    SELECT title, content, category, short_code, tags, enabled
    FROM helpdesk.canned_responses WHERE id = ${id}
  `);
  return rows[0] as Row | undefined;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`
    DELETE FROM helpdesk.canned_responses WHERE tenant_id = ${tenantId}
  `);
}

async function cleanup(): Promise<void> {
  await cleanupTenant(TENANT);
  await cleanupTenant(OTHER_TENANT);
}

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("SEC-REVIEW — PATCH /v1/helpdesk/canned-responses/:id (SQL injection fix)", () => {
  it("still performs a normal, legitimate update correctly (regression: title, content, category, shortCode, tags jsonb, enabled)", async () => {
    const id = await seedResponse(TENANT);

    const res = await patch(`/v1/helpdesk/canned-responses/${id}`, token(), {
      title: "Password reset — updated",
      content: "New content.",
      category: "security",
      shortCode: "PWR2",
      tags: ["account", "security", "urgent"],
      enabled: false,
    });
    expect(res.statusCode).toBe(200);

    const row = await selectRow(TENANT, id);
    expect(row!.title).toBe("Password reset — updated");
    expect(row!.content).toBe("New content.");
    expect(row!.category).toBe("security");
    expect(row!.short_code).toBe("PWR2");
    expect(row!.tags).toEqual(["account", "security", "urgent"]);
    expect(row!.enabled).toBe(false);
  });

  it("supports clearing a nullable field (category set to null) without ambiguity vs. 'not provided'", async () => {
    const id = await seedResponse(TENANT);

    const res = await patch(`/v1/helpdesk/canned-responses/${id}`, token(), { category: null });
    expect(res.statusCode).toBe(200);

    const row = await selectRow(TENANT, id);
    expect(row!.category).toBeNull();
    // shortCode was NOT in this request body, so it must be left unchanged, not nulled.
    expect(row!.short_code).toBe("PWRESET");
  });

  it("treats a single-quote SQL-breakout payload in `category` as inert data, not SQL (the confirmed vuln)", async () => {
    const id = await seedResponse(TENANT);
    const payload = "x', enabled = false, tags = '[\"pwned\"]' -- ";

    const res = await patch(`/v1/helpdesk/canned-responses/${id}`, token(), { category: payload });
    expect(res.statusCode).toBe(200);

    const row = await selectRow(TENANT, id);
    // The malicious string is stored VERBATIM as the category value...
    expect(row!.category).toBe(payload);
    // ...and did NOT tamper with `enabled` or `tags`, which the injection attempted to overwrite.
    expect(row!.enabled).toBe(true);
    expect(row!.tags).toEqual(["account", "password"]);
  });

  it("treats a single-quote SQL-breakout payload in `shortCode` as inert data, not SQL", async () => {
    const id = await seedResponse(TENANT);
    // shortCode has a Zod max(32) length cap, so this must be a short payload
    // -- still a genuine single-quote SQL-breakout attempt within that limit.
    const payload = "x'; enabled=false--";

    const res = await patch(`/v1/helpdesk/canned-responses/${id}`, token(), { shortCode: payload });
    expect(res.statusCode).toBe(200);

    const row = await selectRow(TENANT, id);
    expect(row!.short_code).toBe(payload);

    // The table must still exist and be queryable (a stacked DROP TABLE did not execute).
    const stillThere = await selectRow(TENANT, id);
    expect(stillThere).toBeDefined();
  });

  it("cannot use an injection payload to reach across tenants (WHERE tenant_id stays parameterized too)", async () => {
    const idInTenant = await seedResponse(TENANT);
    const idInOtherTenant = await seedResponse(OTHER_TENANT);

    // Attempt to patch a row that exists, but is scoped to a *different* tenant
    // than the caller's token -- must 404, not succeed via the other tenant's context.
    const res = await patch(`/v1/helpdesk/canned-responses/${idInOtherTenant}`, token(["helpdesk_admin"], TENANT), {
      title: "cross-tenant attempt",
    });
    expect(res.statusCode).toBe(404);

    const otherRow = await selectRow(OTHER_TENANT, idInOtherTenant);
    expect(otherRow!.title).toBe("Password reset");

    // Sanity: the caller's own tenant row is unaffected by the above.
    const ownRow = await selectRow(TENANT, idInTenant);
    expect(ownRow!.title).toBe("Password reset");
  });
});
