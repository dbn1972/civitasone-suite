/**
 * Human-facing reference numbers (application ref_no, intake tracking_no, RTI
 * rti_no, helpdesk ticket_no, notice notice_no) come from Postgres SEQUENCEs
 * (migrations/0042_reference_number_sequences.sql), not Date.now()/random bytes/
 * uuid prefixes. DB-backed, real route -> queue -> consumer -> table round trips.
 *
 *  1. 50 concurrent creates per number type -> 50 distinct persisted numbers.
 *  2. A retried command persists exactly once (a transient failure inside the
 *     consumer transaction is retried by the queue; one row, one number).
 *  3. A terminal failure of a create command leaves an audited failure record.
 *  4. Migration 0042 is re-runnable: it seeds past existing numbers, never
 *     rewinds a sequence, and restores FORCE RLS exactly.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { auditFailedCreate, formatNumber, istYear } from "../src/shared/numbers.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";
import { registerEngagementConsumers } from "../src/modules/engagement/consumer.js";
import * as appRepo from "../src/modules/application/repo.js";
import * as rtiRepo from "../src/modules/rti/repo.js";
import * as ticketRepo from "../src/modules/helpdesk/repo.js";
import * as engagementRepo from "../src/modules/engagement/repo.js";
import * as catalogueRepo from "../src/modules/catalogue/repo.js";
import * as engagementCommands from "../src/modules/engagement/commands.js";

registerApplicationConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);
registerEngagementConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const N = 50;
const TENANT = randomUUID();
const OFFICER = randomUUID();
const SYSTEM = randomUUID();
const SERVICE_ID = randomUUID();
const SERVICE_KEY = `refnum-${randomUUID().slice(0, 8)}`;
const YEAR = String(istYear());

const auth = () => ({
  authorization: `Bearer ${signToken({ sub: OFFICER, tid: TENANT, roles: ["citizen_officer"], sid: "s-refnum" }, SECRET, 3600)}`,
  "content-type": "application/json",
  "x-tenant-id": TENANT,
});
const ctx = (): RequestContext => ({ tenantId: TENANT, actorId: OFFICER, correlationId: randomUUID(), roles: ["citizen_officer"] } as unknown as RequestContext);

let app: FastifyInstance;

async function persisted(table: string, col: string, ids: string[]): Promise<Array<{ id: string; no: string }>> {
  if (ids.length === 0) return [];
  const rows = await sqlClient.begin(async (s) => {
    await s`select set_config('app.tenant_id', ${TENANT}, true)`;
    return s.unsafe(`SELECT id::text AS id, ${col} AS no FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [TENANT, ids] as never);
  });
  return rows as unknown as Array<{ id: string; no: string }>;
}

async function waitForRows(table: string, col: string, ids: string[], ms = 30000) {
  const start = Date.now();
  for (;;) {
    const rows = await persisted(table, col, ids);
    if (rows.length === ids.length) return rows;
    if (Date.now() - start > ms) throw new Error(`timeout: ${rows.length}/${ids.length} rows in ${table}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function outboxAuditFor(messageId: string) {
  return runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`),
    ),
  );
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await catalogueRepo.insertDefinition(tx, {
        id: randomUUID(), tenantId: TENANT, serviceKey: SERVICE_KEY, serviceId: SERVICE_ID, name: "Ref number fixture",
        servicePattern: "certificate", ownerDepartment: "Licensing", version: 1, status: "published", channels: ["portal"],
        requiredDocuments: [], forms: [], outputs: [], statutoryReferences: [], slaDays: 7,
        publishedBy: SYSTEM, publishedAt: new Date(), createdBy: SYSTEM, updatedBy: SYSTEM,
      });
    }),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
  await sqlClient.end();
});

// The app rate-limits per (tenant, ip) at 200/min; a fresh source address per 100 requests keeps the
// 50-wide bursts below it without touching the limiter.
let reqSeq = 0;
const post = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(), payload: payload as never, remoteAddress: `10.20.${Math.floor(reqSeq++ / 100)}.7` });
const mkApplication = () => post("/v1/citizen/applications", { serviceId: randomUUID(), serviceType: "certificate", documentTypes: [] });
const mkRti = () => post("/v1/citizen/rti", { subject: "Road repair status", description: "Details of the road repair work", cpioRef: randomUUID() });
const mkTicket = () => post("/v1/citizen/tickets", { subject: "Water supply", description: "No water since morning" });
const mkDraft = () => post("/v1/citizen/intake/drafts", { serviceId: SERVICE_ID, serviceKey: SERVICE_KEY, channel: "portal", formData: { name: "Asha" }, documentTypes: [] });

describe("pure formatting", () => {
  it("renders PREFIX-YYYY-NNNNNN for every number type", () => {
    expect(formatNumber("application_ref", 2026, 123)).toBe("APP-2026-000123");
    expect(formatNumber("tracking_no", 2026, 123)).toBe("CIT-2026-000123");
    expect(formatNumber("rti_no", 2026, 123)).toBe("RTI/2026/000123");
    expect(formatNumber("ticket_no", 2026, 123)).toBe("HD-2026-000123");
    expect(formatNumber("notice_no", 2026, 123)).toBe("NTC-2026-000123");
  });
  it("the year is IST, not UTC (31 Dec 20:00 UTC is already 1 Jan in India)", () => {
    expect(istYear(new Date("2026-12-31T20:00:00Z"))).toBe(2027);
    expect(istYear(new Date("2026-12-31T10:00:00Z"))).toBe(2026);
  });
});

describe(`${N} concurrent creates -> ${N} distinct persisted numbers`, () => {
  it("application ref_no", async () => {
    const res = await Promise.all(Array.from({ length: N }, mkApplication));
    expect(res.every((r) => r.statusCode === 202)).toBe(true);
    const ids = res.map((r) => r.json().id as string);
    const rows = await waitForRows("application.citizen_applications", "ref_no", ids);
    expect(new Set(rows.map((r) => r.no)).size).toBe(N);
    for (const r of rows) expect(r.no).toMatch(new RegExp(`^APP-${YEAR}-\\d{6}$`));
  });

  it("RTI rti_no", async () => {
    const res = await Promise.all(Array.from({ length: N }, mkRti));
    expect(res.every((r) => r.statusCode === 202)).toBe(true);
    const ids = res.map((r) => r.json().id as string);
    const rows = await waitForRows("rti.citizen_rti_requests", "rti_no", ids);
    expect(new Set(rows.map((r) => r.no)).size).toBe(N);
    for (const r of rows) expect(r.no).toMatch(new RegExp(`^RTI/${YEAR}/\\d{6}$`));
  });

  it("helpdesk ticket_no (the 202 ack carries the same number that is persisted)", async () => {
    const res = await Promise.all(Array.from({ length: N }, mkTicket));
    expect(res.every((r) => r.statusCode === 202)).toBe(true);
    const acks = res.map((r) => r.json() as { id: string; data: { ticketNo: string } });
    expect(new Set(acks.map((a) => a.data.ticketNo)).size).toBe(N);
    const rows = await waitForRows("helpdesk.citizen_tickets", "ticket_no", acks.map((a) => a.id));
    expect(new Set(rows.map((r) => r.no)).size).toBe(N);
    const byId = new Map(rows.map((r) => [r.id, r.no]));
    for (const a of acks) {
      expect(byId.get(a.id)).toBe(a.data.ticketNo);
      expect(a.data.ticketNo).toMatch(new RegExp(`^HD-${YEAR}-\\d{6}$`));
    }
  });

  it("notice notice_no (auto-numbered)", async () => {
    const accepted = await Promise.all(Array.from({ length: N }, () =>
      engagementCommands.createNotice(ctx(), { subject: "Hearing", department: "Public Works" } as never)));
    const rows = await waitForRows("engagement.citizen_notices", "notice_no", accepted.map((a) => a.id));
    expect(new Set(rows.map((r) => r.no)).size).toBe(N);
    for (const r of rows) expect(r.no).toMatch(new RegExp(`^NTC-${YEAR}-\\d{6}$`));
  });

  it("intake tracking_no (the 202 response carries the same number that is persisted)", async () => {
    const drafts = await Promise.all(Array.from({ length: N }, mkDraft));
    expect(drafts.every((r) => r.statusCode === 202)).toBe(true);
    const draftIds = drafts.map((r) => r.json().id as string);
    await waitForRows("application.application_drafts", "status", draftIds);
    const submits = await Promise.all(draftIds.map((id) => post(`/v1/citizen/intake/drafts/${id}/submit`, {})));
    expect(submits.map((r) => r.statusCode)).toEqual(Array(N).fill(202));
    const acks = submits.map((r) => r.json() as { applicationId: string; trackingNo: string });
    expect(new Set(acks.map((a) => a.trackingNo)).size).toBe(N);
    const rows = await waitForRows("application.citizen_applications", "tracking_no", acks.map((a) => a.applicationId));
    const byId = new Map(rows.map((r) => [r.id, r.no]));
    expect(new Set(rows.map((r) => r.no)).size).toBe(N);
    for (const a of acks) {
      expect(byId.get(a.applicationId)).toBe(a.trackingNo);
      expect(a.trackingNo).toMatch(new RegExp(`^CIT-${YEAR}-\\d{6}$`));
    }
  });
});

describe("staff-supplied noticeNo vs the reserved auto-number space", () => {
  it("rejects a noticeNo in the reserved NTC-YYYY-NNNNNN format with 400 VALIDATION_FAILED", async () => {
    const res = await post("/v1/citizen/notices", { noticeNo: "NTC-2026-000123", subject: "Reserved", department: "Public Works" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("still accepts a non-reserved legacy noticeNo and stores it as given", async () => {
    const legacy = `NTC-2026-1A${randomUUID().slice(0, 6).toUpperCase()}`;
    const res = await post("/v1/citizen/notices", { noticeNo: legacy, subject: "Legacy", department: "Public Works" });
    expect(res.statusCode).toBe(202);
    const [row] = await waitForRows("engagement.citizen_notices", "notice_no", [res.json().id as string]);
    expect(row!.no).toBe(legacy);
  });
});

describe("a retried command persists exactly once", () => {
  async function countRows(table: string, id: string) {
    return (await persisted(table, "id", [id])).length;
  }

  it("application: a transient failure inside the consumer transaction is retried and persists one row", async () => {
    const spy = vi.spyOn(appRepo, "insertApplication").mockRejectedValueOnce(new Error("transient"));
    const res = await mkApplication();
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const [row] = await waitForRows("application.citizen_applications", "ref_no", [id]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row!.no).toMatch(new RegExp(`^APP-${YEAR}-\\d{6}$`));
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("application.citizen_applications", id)).toBe(1);
    spy.mockRestore();
  });

  it("RTI: retried once, one row", async () => {
    const spy = vi.spyOn(rtiRepo, "insertRti").mockRejectedValueOnce(new Error("transient"));
    const id = (await mkRti()).json().id as string;
    const [row] = await waitForRows("rti.citizen_rti_requests", "rti_no", [id]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row!.no).toMatch(new RegExp(`^RTI/${YEAR}/\\d{6}$`));
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("rti.citizen_rti_requests", id)).toBe(1);
    spy.mockRestore();
  });

  it("ticket: retried once, one row, and the persisted number is the one the caller was given", async () => {
    const spy = vi.spyOn(ticketRepo, "insertTicket").mockRejectedValueOnce(new Error("transient"));
    const ack = (await mkTicket()).json() as { id: string; data: { ticketNo: string } };
    const [row] = await waitForRows("helpdesk.citizen_tickets", "ticket_no", [ack.id]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row!.no).toBe(ack.data.ticketNo);
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("helpdesk.citizen_tickets", ack.id)).toBe(1);
    spy.mockRestore();
  });

  it("notice: retried once, one row", async () => {
    const spy = vi.spyOn(engagementRepo, "insertNotice").mockRejectedValueOnce(new Error("transient"));
    const { id } = await engagementCommands.createNotice(ctx(), { subject: "Retry", department: "Estates" } as never);
    const [row] = await waitForRows("engagement.citizen_notices", "notice_no", [id]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row!.no).toMatch(new RegExp(`^NTC-${YEAR}-\\d{6}$`));
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("engagement.citizen_notices", id)).toBe(1);
    spy.mockRestore();
  });

  it("intake submit: retried once, one application, and the persisted tracking_no is the one the caller was given", async () => {
    const draftId = (await mkDraft()).json().id as string;
    await waitForRows("application.application_drafts", "status", [draftId]);
    const spy = vi.spyOn(appRepo, "insertApplication").mockRejectedValueOnce(new Error("transient"));
    const ack = (await post(`/v1/citizen/intake/drafts/${draftId}/submit`, {})).json() as { applicationId: string; trackingNo: string };
    const [row] = await waitForRows("application.citizen_applications", "tracking_no", [ack.applicationId]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(row!.no).toBe(ack.trackingNo);
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("application.citizen_applications", ack.applicationId)).toBe(1);
    spy.mockRestore();
  });

  it("the same command redelivered (same messageId) is applied once", async () => {
    const id = randomUUID();
    const env = {
      messageId: id, type: COMMANDS.rtiFile, tenantId: TENANT, actorId: OFFICER, correlationId: id, schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, subject: "Dup", description: "Dup delivery", cpioRef: randomUUID() },
    };
    await queue.publish(COMMANDS.rtiFile, env);
    await queue.publish(COMMANDS.rtiFile, env);
    await waitForRows("rti.citizen_rti_requests", "rti_no", [id]);
    await new Promise((r) => setTimeout(r, 300));
    expect(await countRows("rti.citizen_rti_requests", id)).toBe(1);
  });
});

describe("terminal failure of a create command is audited, never silent", () => {
  it("onOutcome(failed) records audit.event.record outcome=failure; succeeded records nothing", async () => {
    const failed = randomUUID();
    const ok = randomUUID();
    const hook = auditFailedCreate("file", "citizen_rti").onOutcome!;
    await hook({ messageId: failed, tenantId: TENANT, topic: "t", status: "failed", reason: "boom" });
    await hook({ messageId: ok, tenantId: TENANT, topic: "t", status: "succeeded" });
    const rows = await outboxAuditFor(failed);
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, any> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("file");
    expect((await outboxAuditFor(ok)).length).toBe(0);
  });

  // Each REGISTERED consumer must have the hook wired (tenantScoped forwards the options).
  const cases: Array<[string, string, string]> = [
    ["application.submit", COMMANDS.applicationSubmit, "submit"],
    ["intake draft.submit", COMMANDS.draftSubmit, "draft_submit"],
    ["rti.file", COMMANDS.rtiFile, "file"],
    ["ticket.create", COMMANDS.ticketCreate, "create"],
    ["notice.create", COMMANDS.noticeCreate, "create"],
  ];
  it.each(cases)("%s that fails on every retry leaves an audited failure record", async (_n, topic, action) => {
    const messageId = randomUUID();
    // id is not a uuid -> the INSERT throws on every attempt; the queue exhausts maxAttempts and fires onOutcome(failed).
    await queue.publish(topic, {
      messageId, type: topic, tenantId: TENANT, actorId: OFFICER, correlationId: messageId, schemaVersion: "1.0",
      payload: { id: "not-a-uuid", draftId: "not-a-uuid", tenantId: TENANT, citizenId: OFFICER, serviceId: randomUUID(), serviceType: "x",
        subject: "s", description: "d", department: "d", cpioRef: randomUUID(), trackingNo: "CIT-0000-000000", channel: "portal" },
    });
    const start = Date.now();
    let rows: unknown[] = [];
    while (Date.now() - start < 20000) {
      rows = (await outboxAuditFor(messageId)) as unknown[];
      if (rows.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, any> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe(action);
    expect(payload.details.status).toBe("failed");
  });
});

describe("migration 0042 is re-runnable (owner role, no tenant GUC) and never re-issues numbers", () => {
  const migrationSql = readFileSync(
    fileURLToPath(new URL("../migrations/0042_reference_number_sequences.sql", import.meta.url)),
    "utf8",
  );
  const SEEDED_N = 700000 + Math.floor(Math.random() * 90000);
  const SEEDED = `APP-2026-${String(SEEDED_N).padStart(6, "0")}`;
  const rowId = randomUUID();

  // postgres.js refuses BEGIN/COMMIT on its pooled client; run the file on ONE reserved connection
  // (same single-session shape as the migration runner).
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(migrationSql); } finally { conn.release(); }
  }

  afterAll(async () => {
    await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(sql`DELETE FROM application.citizen_applications WHERE id = ${rowId}`)),
    );
  });

  it("seeds past an existing row, never rewinds, and restores FORCE RLS exactly", async () => {
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        appRepo.insertApplication(tx, {
          id: rowId, tenantId: TENANT, citizenId: OFFICER, serviceId: randomUUID(), refNo: SEEDED, status: "submitted",
          createdBy: OFFICER, updatedBy: OFFICER,
        } as never),
      ),
    );
    const force = (await sqlClient.unsafe(
      `SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN (
         'application.citizen_applications'::regclass, 'rti.citizen_rti_requests'::regclass,
         'helpdesk.citizen_tickets'::regclass, 'engagement.citizen_notices'::regclass)`,
    )) as unknown as Array<{ relname: string; relforcerowsecurity: boolean }>;
    force.sort((a, b) => a.relname.localeCompare(b.relname));
    expect(force.length).toBe(4);
    await runMigrationFile();
    const next = await sqlClient.unsafe(`SELECT nextval('application.application_ref_seq')::bigint AS n`);
    expect(Number((next[0] as { n: string }).n)).toBeGreaterThan(SEEDED_N);
    const after = (await sqlClient.unsafe(
      `SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN (
         'application.citizen_applications'::regclass, 'rti.citizen_rti_requests'::regclass,
         'helpdesk.citizen_tickets'::regclass, 'engagement.citizen_notices'::regclass)`,
    )) as unknown as Array<{ relname: string; relforcerowsecurity: boolean }>;
    after.sort((a, b) => a.relname.localeCompare(b.relname));
    expect(after).toEqual(force); // each table's FORCE flag is exactly what it was
  });

  it("a second run never rewinds any sequence", async () => {
    const seqs = ["application.application_ref_seq", "application.tracking_no_seq", "rti.rti_no_seq", "helpdesk.ticket_no_seq", "engagement.notice_no_seq"];
    const before: number[] = [];
    for (const s of seqs) before.push(Number(((await sqlClient.unsafe(`SELECT nextval('${s}')::bigint AS n`))[0] as { n: string }).n));
    await runMigrationFile();
    for (const [i, s] of seqs.entries()) {
      const n = Number(((await sqlClient.unsafe(`SELECT nextval('${s}')::bigint AS n`))[0] as { n: string }).n);
      expect(n).toBeGreaterThan(before[i]!);
    }
  });
});
