/**
 * GAP-HR-AUDIT-LOG-04: GET /audit/events/count and GET /audit/events/export.
 *
 * The HR audit-log page used to show only a page of rows with no total and
 * exported just the rows already on screen. These routes give it the real
 * tenant-scoped match count and a CSV of EVERY matching event, using exactly
 * the same filters as the list route. Seeds through the real consumer
 * (events.events is append-only; see events-routes.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Read at module load by exports/validators.ts -- must be set before the app is imported.
vi.hoisted(() => {
  process.env.EXPORT_MAX_ROWS = "5";
});

import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import { registerAuditConsumers } from "../src/modules/events/consumer.js";

// Set by this package's vitest config (env.JWT_SECRET); never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const ACTOR_C = randomUUID();
const token = (roles: string[] = ["audit_officer"], tid = TENANT) =>
  signToken({ sub: randomUUID(), tid, roles, sid: "s" }, SECRET, 3600);
const EPOCH = "from=1970-01-01T00:00:00.000Z";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

/** Minimal RFC-4180 parser (quoted fields, doubled quotes, CRLF rows). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

let app: FastifyInstance;

async function count(qs: string, tok = token()): Promise<{ status: number; total?: number }> {
  const res = await app.inject({ method: "GET", url: `/audit/events/count?${qs}`, headers: { authorization: `Bearer ${tok}` } });
  return { status: res.statusCode, total: res.statusCode === 200 ? res.json().total : undefined };
}
async function exportCsv(qs: string, tok = token()) {
  return app.inject({ method: "GET", url: `/audit/events/export?${qs}`, headers: { authorization: `Bearer ${tok}` } });
}
async function listLen(qs: string): Promise<number> {
  const res = await app.inject({ method: "GET", url: `/audit/events?${qs}&limit=200`, headers: { authorization: `Bearer ${token()}` } });
  expect(res.statusCode).toBe(200);
  return (res.json() as unknown[]).length;
}

beforeAll(async () => {
  app = await buildApp();
  const q = wire(new MemoryQueue());
  registerAuditConsumers(q);
  await q.start();
  const publish = (tenantId: string, actorId: string, actor: Record<string, unknown>, payload: Record<string, unknown>) =>
    q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId, actorId,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { outcome: "success", action: "update", actor, ...payload },
    });
  await publish(TENANT, ACTOR_A, { email: "Asha.Rao@gov.in" }, { service: "hrms", resourceType: "employee", resourceId: "e1" });
  await publish(TENANT, ACTOR_A, { email: "Asha.Rao@gov.in" }, { service: "payroll", resourceType: "payroll_run", resourceId: "p1" });
  await publish(TENANT, ACTOR_B, { name: "=1+1" }, { service: "hrms", resourceType: "leave_app", resourceId: "l1" });
  await publish(TENANT, ACTOR_B, {}, { service: "policy", resourceType: "role", resourceId: "r1" });
  await publish(TENANT, ACTOR_C, { name: 'Dr. "Quote", Comma' }, { service: "hrms", resourceType: "employee", resourceId: "e2", outcome: "failure" });
  await publish(TENANT, ACTOR_C, { email: "c@gov.in" }, { service: "hrms", resourceType: "apar", resourceId: "a1", outcome: undefined, severity: "error" });
  await publish(OTHER_TENANT, ACTOR_A, { email: "other@gov.in" }, { service: "hrms", resourceType: "employee", resourceId: "x1" });
  // Poll for the seeded rows instead of a fixed sleep: the consumer serialises
  // per-tenant hash-chain appends, so under parallel test load a fixed delay is flaky.
  for (let i = 0; i < 80; i++) {
    const n = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT))))).length;
    const m = (await runWithTenant(OTHER_TENANT, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, OTHER_TENANT))))).length;
    if (n >= 6 && m >= 1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await q.stop();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /audit/events/count", () => {
  it("counts every event of the caller's tenant in range, and none of another tenant's", async () => {
    expect(await count(EPOCH)).toEqual({ status: 200, total: 6 });
    expect((await count(EPOCH, token(["audit_officer"], OTHER_TENANT))).total).toBe(1);
  });

  it("applies the same service / resourceType / actor filters as the list route, so total always equals the list size", async () => {
    for (const qs of [
      `${EPOCH}&service=hrms,payroll`,
      `${EPOCH}&service=hrms`,
      `${EPOCH}&resourceType=employee`,
      `${EPOCH}&service=hrms&resourceType=employee`,
      `${EPOCH}&actor=asha.rao`,
      `${EPOCH}&actor=${ACTOR_B}`,
      `${EPOCH}&service=nothing`,
    ]) {
      expect((await count(qs)).total, qs).toBe(await listLen(qs));
    }
    expect((await count(`${EPOCH}&service=hrms,payroll`)).total).toBe(5);
    expect((await count(`${EPOCH}&service=hrms&resourceType=employee`)).total).toBe(2);
  });

  it("honours the date range (a window entirely in the past matches nothing)", async () => {
    expect((await count("from=2001-01-01T00:00:00.000Z&to=2001-12-31T00:00:00.000Z")).total).toBe(0);
  });

  it("rejects roles without audit access (403) and bad filters (400)", async () => {
    expect((await count(EPOCH, token(["hr_admin"]))).status).toBe(403);
    expect((await count("from=not-a-date")).status).toBe(400);
  });
});

describe("GET /audit/events/export", () => {
  it("returns a CSV of every matching event -- the same set the list route shows -- not a page", async () => {
    const res = await exportCsv(`${EPOCH}&service=hrms,payroll`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="audit-events-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-export-row-count"]).toBe("5");
    const body = res.body.replace(/^﻿/, "");
    const rows = parseCsv(body);
    expect(rows[0]).toEqual(["Event ID", "Occurred at (UTC)", "Service", "Action", "Event type", "Resource type", "Resource ID", "Actor", "Actor ID", "Outcome", "Severity"]);
    expect(rows.length - 1).toBe(5);
    expect(rows.length - 1).toBe(await listLen(`${EPOCH}&service=hrms,payroll`));
    expect(res.body.startsWith("﻿")).toBe(true);
  });

  it("carries action, resource type/id, actor and the producer's own outcome (severity only when no outcome)", async () => {
    const rows = parseCsv((await exportCsv(`${EPOCH}&service=hrms,payroll`)).body.replace(/^﻿/, "")).slice(1);
    const byResource = (id: string) => rows.find((r) => r[6] === id)!;
    expect(byResource("e1")).toEqual(expect.arrayContaining(["hrms", "update", "employee", "Asha.Rao@gov.in", ACTOR_A, "success", "info"]));
    expect(byResource("e2")[9]).toBe("failure"); // payload.outcome = failure
    expect(byResource("p1")[2]).toBe("payroll");
  });

  it("neutralises spreadsheet formulas and keeps quotes/commas intact (CSV injection guard)", async () => {
    const rows = parseCsv((await exportCsv(`${EPOCH}&resourceType=leave_app`)).body.replace(/^﻿/, "")).slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]![7]).toBe("'=1+1");
    const quoted = parseCsv((await exportCsv(`${EPOCH}&resourceType=employee&actor=quote`)).body.replace(/^﻿/, "")).slice(1);
    expect(quoted[0]![7]).toBe('Dr. "Quote", Comma');
  });

  it("falls back to the actor id (never drops the row) when the event carries no email or name", async () => {
    const rows = parseCsv((await exportCsv(`${EPOCH}&resourceType=role`)).body.replace(/^﻿/, "")).slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]![7]).toBe(ACTOR_B);
  });

  it("records the export on the audit trail itself before returning the file (who, how many, which filters)", async () => {
    const before = (await count(`${EPOCH}&service=audit`)).total ?? 0;
    const res = await exportCsv(`${EPOCH}&service=hrms`);
    expect(res.statusCode).toBe(200);
    expect((await count(`${EPOCH}&service=audit`)).total).toBe(before + 1);
    const list = await app.inject({
      method: "GET", url: `/audit/events?${EPOCH}&type=audit.events.exported&limit=50`,
      headers: { authorization: `Bearer ${token()}` },
    });
    const events = list.json() as Array<{ payload: { rowCount: number; format: string; filters: Record<string, unknown>; resourceType: string }; type: string }>;
    const latest = events[0]!;
    expect(latest.type).toBe("audit.events.exported");
    expect(latest.payload.rowCount).toBe(4);
    expect(latest.payload.format).toBe("csv");
    expect(latest.payload.resourceType).toBe("audit_export");
    expect(latest.payload.filters).toMatchObject({ services: ["hrms"] });
  });

  it("refuses with 413 -- never a silently truncated file -- when more events match than the export cap, and records nothing", async () => {
    const exported = async () => (await count(`${EPOCH}&service=audit`)).total ?? 0;
    const before = await exported();
    // EXPORT_MAX_ROWS is 5 for this file; 6+ events match, so this must refuse...
    const tooMany = await exportCsv(EPOCH);
    expect(tooMany.statusCode).toBe(413);
    expect(tooMany.json().code).toBe("EXPORT_TOO_LARGE");
    // ...with no audit entry (no data left the system)...
    expect(await exported()).toBe(before);
    // ...while a narrower filter under the cap still succeeds.
    expect((await exportCsv(`${EPOCH}&service=hrms`)).statusCode).toBe(200);
  });

  it("rejects roles without audit access (403) and is tenant-scoped", async () => {
    expect((await exportCsv(EPOCH, token(["hr_admin"]))).statusCode).toBe(403);
    const other = await exportCsv(EPOCH, token(["audit_officer"], OTHER_TENANT));
    expect(other.statusCode).toBe(200);
    expect(other.headers["x-export-row-count"]).toBe("1");
    expect(other.body).not.toContain("Asha.Rao@gov.in");
  });
});
