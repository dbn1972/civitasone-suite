/**
 * Helpdesk internal notes must never reach the citizen.
 *
 * Before: the web sent an "internal note" as a public note prefixed "[INTERNAL] "
 * and the read model hardcoded isInternal=false, so the owning citizen could read
 * staff-only notes. Now citizen_ticket_notes.is_internal is a real column, set only
 * through the staff-gated notes route, and filtered out of every citizen-facing read
 * (detail and the slaStatus detail list).
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";

registerHelpdeskConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET!;
const TENANT = "aaaaaaaa-2222-4000-8000-0000000000b1";
const OWNER = "11111111-2222-4000-8000-0000000000b1";
const OTHER = "22222222-2222-4000-8000-0000000000b1";
const AGENT = "99999999-2222-4000-8000-0000000000b1";

const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json" });
const ownerH = hdr(OWNER, ["citizen"]);
const otherH = hdr(OTHER, ["citizen"]);
const agentH = hdr(AGENT, ["helpdesk_agent"]);

const app = await buildApp();
let ticketId = "";

type Comment = { content: string; isInternal: boolean };
async function comments(url: string, h: Record<string, string>): Promise<Comment[]> {
  const r = await app.inject({ method: "GET", url, headers: h });
  expect(r.statusCode).toBe(200);
  const body = r.json() as { comments?: Comment[]; data?: Array<{ id: string; comments: Comment[] }> };
  if (body.comments) return body.comments;
  return body.data!.find((t) => t.id === ticketId)?.comments ?? [];
}
async function waitForComments(n: number): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await comments(`/v1/citizen/tickets/${ticketId}`, agentH)).length >= n) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`timed out waiting for ${n} comments`);
}

beforeAll(async () => {
  const t = await app.inject({
    method: "POST", url: "/v1/citizen/tickets", headers: agentH,
    payload: { citizenId: OWNER, subject: "help", description: "stuck", priority: "medium", channel: "web" },
  });
  ticketId = JSON.parse(t.body).id;
  for (let i = 0; i < 60; i++) {
    if ((await app.inject({ method: "GET", url: `/v1/citizen/tickets/${ticketId}`, headers: agentH })).statusCode === 200) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  const pub = await app.inject({ method: "POST", url: `/v1/citizen/tickets/${ticketId}/notes`, headers: agentH, payload: { body: "public reply to citizen" } });
  expect(pub.statusCode).toBe(202);
  await waitForComments(1);
  const internal = await app.inject({ method: "POST", url: `/v1/citizen/tickets/${ticketId}/notes`, headers: agentH, payload: { body: "staff only aside", isInternal: true } });
  expect(internal.statusCode).toBe(202);
  await waitForComments(2);
  // Make the ticket SLA-breached so the slaStatus detail-list path returns it.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`UPDATE helpdesk.citizen_tickets SET sla_due_at = now() - interval '1 hour' WHERE id = ${ticketId}`;
  });
}, 30000);

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM helpdesk.citizen_ticket_notes WHERE ticket_id = ${ticketId}`;
    await sql`DELETE FROM helpdesk.citizen_tickets WHERE id = ${ticketId}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("internal notes are staff-only", () => {
  it("persists is_internal as a real column (not a body prefix)", async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return (await sql`SELECT body, is_internal FROM helpdesk.citizen_ticket_notes WHERE ticket_id = ${ticketId} ORDER BY created_at`) as unknown as Array<{ body: string; is_internal: boolean }>;
    });
    expect(rows.map((r) => [r.body, r.is_internal])).toEqual([["public reply to citizen", false], ["staff only aside", true]]);
  });

  it("staff see both notes, with the internal one flagged", async () => {
    const c = await comments(`/v1/citizen/tickets/${ticketId}`, agentH);
    expect(c.find((x) => x.content === "staff only aside")?.isInternal).toBe(true);
    expect(c.find((x) => x.content === "public reply to citizen")?.isInternal).toBe(false);
  });

  it("the owning citizen sees the public note but never the internal one (detail)", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/citizen/tickets/${ticketId}`, headers: ownerH });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("staff only aside");
    const c = (r.json() as { comments: Comment[] }).comments;
    expect(c.map((x) => x.content)).toEqual(["public reply to citizen"]);
    expect(c.every((x) => x.isInternal === false)).toBe(true);
  });

  it("the owning citizen never sees the internal note in the slaStatus detail list (staff still do)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/citizen/tickets?slaStatus=breached&limit=500", headers: ownerH });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("staff only aside");
    expect(r.body).toContain("public reply to citizen");
    // staff, on the same list, do get the internal note
    const staff = await app.inject({ method: "GET", url: "/v1/citizen/tickets?slaStatus=breached&limit=500", headers: agentH });
    expect(staff.body).toContain("staff only aside");
  });

  it("a citizen cannot set isInternal (notes route is staff-only: 403), and nothing is written", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/citizen/tickets/${ticketId}/notes`, headers: ownerH, payload: { body: "sneaky", isInternal: true } });
    expect(r.statusCode).toBe(403);
    const r2 = await app.inject({ method: "POST", url: `/v1/citizen/tickets/${ticketId}/notes`, headers: otherH, payload: { body: "sneaky", isInternal: false } });
    expect(r2.statusCode).toBe(403);
    await new Promise((res) => setTimeout(res, 150));
    const c = await comments(`/v1/citizen/tickets/${ticketId}`, agentH);
    expect(c.map((x) => x.content)).not.toContain("sneaky");
  });

  it("a non-boolean isInternal is rejected (400)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/citizen/tickets/${ticketId}/notes`, headers: agentH, payload: { body: "x", isInternal: "yes" } });
    expect(r.statusCode).toBe(400);
  });
});

describe("migration 0038 backfills legacy [INTERNAL] -prefixed notes", () => {
  const legacyId = randomUUID();
  const LEGACY_BODY = "legacy staff aside from before the flag existed";

  it("flags the legacy note internal, strips the prefix, and hides it from the citizen", async () => {
    // Seed exactly what the old web convention stored: a public note with an "[INTERNAL] " prefix.
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`INSERT INTO helpdesk.citizen_ticket_notes (id, tenant_id, ticket_id, author_id, body, is_internal, created_by, updated_by)
                VALUES (${legacyId}, ${TENANT}, ${ticketId}, ${AGENT}, ${"[INTERNAL] " + LEGACY_BODY}, false, ${AGENT}, ${AGENT})`;
    });

    // Before the migration the citizen can read it (the leak being fixed).
    const before = await app.inject({ method: "GET", url: `/v1/citizen/tickets/${ticketId}`, headers: ownerH });
    expect(before.body).toContain(LEGACY_BODY);

    // Run the real migration file as the service role (citizen_svc, NOBYPASSRLS, table owner), on a
    // dedicated connection so its session-level SET lock_timeout does not leak into the pool.
    const sql = readFileSync(new URL("../migrations/0038_helpdesk_note_is_internal.sql", import.meta.url), "utf8");
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(sql); } finally { conn.release(); }

    const row = await sqlClient.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${TENANT}, true)`;
      return ((await tx`SELECT body, is_internal FROM helpdesk.citizen_ticket_notes WHERE id = ${legacyId}`) as unknown as Array<{ body: string; is_internal: boolean }>)[0];
    });
    expect(row).toEqual({ body: LEGACY_BODY, is_internal: true });

    const after = await app.inject({ method: "GET", url: `/v1/citizen/tickets/${ticketId}`, headers: ownerH });
    expect(after.body).not.toContain(LEGACY_BODY);
    expect(after.body).not.toContain("[INTERNAL]");

    const staff = (await comments(`/v1/citizen/tickets/${ticketId}`, agentH)).find((c) => c.content === LEGACY_BODY);
    expect(staff?.isInternal).toBe(true);
  });

  it("is idempotent and keeps FORCE ROW LEVEL SECURITY on the table", async () => {
    const sql = readFileSync(new URL("../migrations/0038_helpdesk_note_is_internal.sql", import.meta.url), "utf8");
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(sql); } finally { conn.release(); }
    const [t] = (await sqlClient`SELECT relforcerowsecurity AS forced, relrowsecurity AS enabled FROM pg_class WHERE oid = 'helpdesk.citizen_ticket_notes'::regclass`) as unknown as Array<{ forced: boolean; enabled: boolean }>;
    expect(t).toEqual({ forced: true, enabled: true });
  });
});
