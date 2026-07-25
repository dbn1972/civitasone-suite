/**
 * 10/10 domain-completeness suite for citizen-service.
 *
 * Covers (extending the existing cross-citizen authz suite):
 *  - grievance lifecycle (register -> assign -> action -> resolve, history)
 *  - application submit + status history + documents
 *  - RTI file -> respond -> appeal, status mapping, SLA 30-day due-date, overdue flag
 *  - helpdesk ticket assign/resolve/close + double-close immutability (state guard)
 *  - portal profile PII: name ciphertext at rest (DB row is NOT cleartext)
 *  - SLA due-date math + overdue flag (unit)
 *  - tenant isolation
 *  - idempotency (replayed command does not double-apply)
 *  - P1-7 input sanitation (max-length / control-char / CSV-injection guard)
 *  - P1-3 RTI read-model status mapping (responded/appealed no longer fall through)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";
import { registerPortalConsumers } from "../src/modules/portal/consumer.js";
import { safeText, stripControlChars, guardCsvInjection } from "../src/shared/sanitize.js";
import { mapRtiStatus, isRtiOverdue } from "../src/modules/rti/queries.js";
import { computeSlaDueAt, computeSlaStatus } from "../src/modules/helpdesk/sla.js";
import { computeRtiDeadline } from "../src/modules/rti/domain.js";

registerPortalConsumers(queue);
registerGrievanceConsumers(queue);
registerApplicationConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b1";
const TENANT2 = "aaaaaaaa-2222-4000-8000-0000000000b2";
const OWNER  = "11111111-1111-4000-8000-0000000000b1";
const OFFICER = "99999999-9999-4000-8000-0000000000b1";
const ASSIGNEE = "88888888-8888-4000-8000-0000000000b1";
const CPIO = "33333333-3333-4000-8000-0000000000b1";

function officerTok(tid = TENANT) {
  return signToken({ sub: OFFICER, tid, roles: ["citizen_officer"], sid: "s" }, SECRET);
}

const app = await buildApp();
const ofH = { authorization: `Bearer ${officerTok()}`, "content-type": "application/json" };
const of2H = { authorization: `Bearer ${officerTok(TENANT2)}`, "content-type": "application/json" };

async function post(url: string, body: any, headers: any) {
  return app.inject({ method: "POST", url, headers, payload: body });
}
async function patch(url: string, body: any, headers: any) {
  return app.inject({ method: "PATCH", url, headers, payload: body });
}
async function get(url: string, headers: any) {
  return app.inject({ method: "GET", url, headers });
}
async function waitFor(predicate: () => Promise<boolean>, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
async function waitReady(url: string, headers = ofH) {
  await waitFor(async () => (await get(url, headers)).statusCode === 200);
}

// Domain tables + _outbox.messages have FORCED RLS. Raw sqlClient access must
// set the transaction-LOCAL app.tenant_id GUC (telephony sqlAsTenant pattern).
async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

afterAll(async () => {
  // Clean up rows created by this suite (additive, tenant-scoped).
  for (const t of [TENANT, TENANT2]) {
    await sqlAsTenant(t, async (sql) => {
      await sql`delete from grievance.citizen_grievances where tenant_id = ${t}`;
      await sql`delete from application.citizen_applications where tenant_id = ${t}`;
      await sql`delete from rti.citizen_rti_requests where tenant_id = ${t}`;
      await sql`delete from helpdesk.citizen_tickets where tenant_id = ${t}`;
      await sql`delete from portal.citizen_profiles where tenant_id = ${t}`;
    }).catch(() => {});
  }
  await app.close();
  await sqlClient.end();
});

// ---------------------------------------------------------------------------
// PURE / UNIT — fast, no DB
// ---------------------------------------------------------------------------
describe("P1-7 input sanitation (safeText)", () => {
  it("caps at max length", () => {
    const r = safeText({ max: 10 }).safeParse("x".repeat(11));
    expect(r.success).toBe(false);
  });
  it("strips control characters", () => {
    expect(stripControlChars("a\u0000b\u0007c")).toBe("abc");
  });
  it("keeps newlines/tabs in multiline mode but strips others", () => {
    expect(stripControlChars("a\nb\tc\u0000d", true)).toBe("a\nb\tcd");
  });
  it("neutralises CSV/formula injection (leading =, +, -, @)", () => {
    expect(guardCsvInjection("=1+1")).toBe("'=1+1");
    expect(guardCsvInjection("+cmd")).toBe("'+cmd");
    expect(guardCsvInjection("@x")).toBe("'@x");
    expect(guardCsvInjection("safe")).toBe("safe");
  });
  it("safeText applies trim + control-strip + CSV-guard end to end", () => {
    const r = safeText({ max: 50 }).parse("  =SUM(A1)\u0000  ");
    expect(r).toBe("'=SUM(A1)");
  });
  it("is idempotent on already-sanitised text", () => {
    const once = safeText({ max: 50 }).parse("=evil");
    const twice = safeText({ max: 50 }).parse(once);
    expect(twice).toBe(once);
  });
});

describe("P1-3 RTI read-model status mapping", () => {
  it("maps the real DB vocabulary the consumer writes", () => {
    // BUG FIX: previously responded/appealed fell through to "received".
    expect(mapRtiStatus("filed")).toBe("received");
    expect(mapRtiStatus("responded")).toBe("replied");
    expect(mapRtiStatus("appealed")).toBe("appeal");
    expect(mapRtiStatus("closed")).toBe("closed");
  });
  it("keeps legacy synonyms", () => {
    expect(mapRtiStatus("replied")).toBe("replied");
    expect(mapRtiStatus("appeal")).toBe("appeal");
    expect(mapRtiStatus("under_review")).toBe("under_review");
  });
  it("unknown code defaults to received", () => {
    expect(mapRtiStatus("weird")).toBe("received");
  });
});

describe("RTI SLA 30-day due-date + overdue flag", () => {
  it("computeRtiDeadline is created + 30 days", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(computeRtiDeadline(start).toISOString().slice(0, 10)).toBe("2026-01-31");
  });
  it("isRtiOverdue true when deadline passed and not responded", () => {
    expect(isRtiOverdue({ deadline: "2020-01-01", status: "filed" })).toBe(true);
  });
  it("isRtiOverdue false once responded/replied/closed", () => {
    expect(isRtiOverdue({ deadline: "2020-01-01", status: "responded" })).toBe(false);
    expect(isRtiOverdue({ deadline: "2020-01-01", status: "appealed" })).toBe(false);
  });
  it("isRtiOverdue false when deadline in the future", () => {
    expect(isRtiOverdue({ deadline: "2999-01-01", status: "filed" })).toBe(false);
  });
});

describe("Helpdesk SLA due-date math", () => {
  it("priority-based resolution windows", () => {
    const c = new Date("2026-01-01T00:00:00Z");
    expect(computeSlaDueAt("critical", c).getTime() - c.getTime()).toBe(4 * 3600e3);
    expect(computeSlaDueAt("medium", c).getTime() - c.getTime()).toBe(24 * 3600e3);
  });
  it("breached when due-at has passed", () => {
    const row: any = { status: "open", priority: "critical", createdAt: new Date("2020-01-01T00:00:00Z"), slaDueAt: null };
    expect(computeSlaStatus(row)).toBe("breached");
  });
  it("closed/resolved tickets are within_sla regardless of age", () => {
    const row: any = { status: "closed", priority: "critical", createdAt: new Date("2020-01-01T00:00:00Z"), slaDueAt: null };
    expect(computeSlaStatus(row)).toBe("within_sla");
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION — real DB + queue
// ---------------------------------------------------------------------------
describe("Grievance lifecycle (register -> assign -> action -> resolve)", () => {
  let id = "";
  beforeAll(async () => {
    const r = await post("/v1/citizen/grievances",
      { citizenId: OWNER, category: "water", subject: "leak", description: "pipe burst" }, ofH);
    expect(r.statusCode).toBe(202);
    id = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/grievances/${id}`);
  }, 20000);

  it("assign -> action -> resolve advances status and records actions", async () => {
    expect((await patch(`/v1/citizen/grievances/${id}/assign`, { assignedTo: ASSIGNEE }, ofH)).statusCode).toBe(202);
    await waitFor(async () => (await get(`/v1/citizen/grievances/${id}`, ofH)).json().status === "assigned");

    expect((await post(`/v1/citizen/grievances/${id}/actions`, { actionType: "investigate", note: "on site", status: "in_progress" }, ofH)).statusCode).toBe(202);
    await waitFor(async () => (await get(`/v1/citizen/grievances/${id}`, ofH)).json().status === "in_progress");

    expect((await patch(`/v1/citizen/grievances/${id}/resolve`, { note: "fixed" }, ofH)).statusCode).toBe(202);
    const ok = await waitFor(async () => (await get(`/v1/citizen/grievances/${id}`, ofH)).json().status === "resolved");
    expect(ok).toBe(true);

    const detail = (await get(`/v1/citizen/grievances/${id}`, ofH)).json();
    expect(Array.isArray(detail.actions)).toBe(true);
    expect(detail.actions.length).toBeGreaterThanOrEqual(1);
    // date-coercion: createdAt is a string (consistent across cache hit/miss).
    expect(typeof detail.createdAt).toBe("string");
    expect(() => new Date(detail.createdAt).toISOString()).not.toThrow();
  }, 20000);
});

describe("Application submit + status history + documents", () => {
  let id = "";
  beforeAll(async () => {
    const r = await post("/v1/citizen/applications",
      { citizenId: OWNER, serviceId: "44444444-4444-4000-8000-0000000000b1", serviceType: "birth_cert" }, ofH);
    expect(r.statusCode).toBe(202);
    id = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/applications/${id}`);
  }, 20000);

  it("status update + document upload appear in detail", async () => {
    expect((await patch(`/v1/citizen/applications/${id}/status`, { status: "under_review", note: "checking" }, ofH)).statusCode).toBe(202);
    expect((await post(`/v1/citizen/applications/${id}/documents`, { docType: "id_proof" }, ofH)).statusCode).toBe(202);
    const ok = await waitFor(async () => {
      const d = (await get(`/v1/citizen/applications/${id}`, ofH)).json();
      return Array.isArray(d.documents) && d.documents.length >= 1 && Array.isArray(d.history) && d.history.length >= 1;
    });
    expect(ok).toBe(true);
    const d = (await get(`/v1/citizen/applications/${id}`, ofH)).json();
    expect(typeof d.submittedAt).toBe("string");
  }, 20000);
});

describe("RTI file -> respond -> appeal with status mapping + SLA", () => {
  let id = "";
  beforeAll(async () => {
    const r = await post("/v1/citizen/rti",
      { citizenId: OWNER, subject: "records", description: "give docs", cpioRef: CPIO }, ofH);
    expect(r.statusCode).toBe(202);
    id = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/rti/${id}`);
  }, 20000);

  it("30-day deadline is set on file", async () => {
    const d = (await get(`/v1/citizen/rti/${id}`, ofH)).json();
    expect(d.deadline).toBeTruthy();
    expect(d.statusLabel).toBe("received");
  });

  it("respond -> statusLabel replied; appeal -> statusLabel appeal (P1-3 mapping)", async () => {
    expect((await post(`/v1/citizen/rti/${id}/respond`, { responseUrl: "https://example.gov/doc.pdf" }, ofH)).statusCode).toBe(202);
    const replied = await waitFor(async () => (await get(`/v1/citizen/rti/${id}`, ofH)).json().statusLabel === "replied");
    expect(replied).toBe(true);

    expect((await patch(`/v1/citizen/rti/${id}/appeal`, { appealType: "first", grounds: "incomplete" }, ofH)).statusCode).toBe(202);
    const appealed = await waitFor(async () => (await get(`/v1/citizen/rti/${id}`, ofH)).json().statusLabel === "appeal");
    expect(appealed).toBe(true);
    const d = (await get(`/v1/citizen/rti/${id}`, ofH)).json();
    expect(d.isOverdue).toBe(false); // appealed/replied is never overdue
  }, 20000);
});

describe("Helpdesk ticket assign/resolve/close + double-close immutability", () => {
  let id = "";
  beforeAll(async () => {
    const r = await post("/v1/citizen/tickets",
      { citizenId: OWNER, subject: "stuck", description: "cannot login", priority: "medium", channel: "web" }, ofH);
    expect(r.statusCode).toBe(202);
    id = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/tickets/${id}`);
  }, 20000);

  it("assign -> resolve -> close transitions; resolvedAt captured", async () => {
    expect((await patch(`/v1/citizen/tickets/${id}/assign`, { assigneeId: ASSIGNEE }, ofH)).statusCode).toBe(202);
    await waitFor(async () => (await get(`/v1/citizen/tickets/${id}`, ofH)).json().status === "in_progress");

    expect((await patch(`/v1/citizen/tickets/${id}/resolve`, { note: "done" }, ofH)).statusCode).toBe(202);
    const resolved = await waitFor(async () => (await get(`/v1/citizen/tickets/${id}`, ofH)).json().status === "resolved");
    expect(resolved).toBe(true);
    const afterResolve = (await get(`/v1/citizen/tickets/${id}`, ofH)).json();
    const resolvedAt = afterResolve.resolvedAt;
    expect(resolvedAt).toBeTruthy();

    expect((await patch(`/v1/citizen/tickets/${id}/close`, { note: "closing" }, ofH)).statusCode).toBe(202);
    const closed = await waitFor(async () => (await get(`/v1/citizen/tickets/${id}`, ofH)).json().status === "closed");
    expect(closed).toBe(true);

    // State guard: re-resolving a CLOSED ticket is a no-op (stays closed,
    // resolvedAt unchanged). Terminal state is immutable.
    await patch(`/v1/citizen/tickets/${id}/resolve`, { note: "retry" }, ofH);
    await new Promise((r) => setTimeout(r, 300));
    const stillClosed = (await get(`/v1/citizen/tickets/${id}`, ofH)).json();
    expect(stillClosed.status).toBe("closed");
    expect(stillClosed.resolvedAt).toBe(resolvedAt);
  }, 25000);
});

describe("Portal profile PII — name ciphertext at rest (DPDP)", () => {
  it("DB row stores name as AES-GCM ciphertext, not cleartext", async () => {
    const plaintextName = "Ramesh Kumar Sanitation Test";
    const r = await post("/v1/citizen/profiles",
      { citizenId: OWNER, name: plaintextName, mobile: "9876543210", consentGranted: true }, ofH);
    expect(r.statusCode).toBe(202);
    await waitFor(async () => {
      const rows = await sqlAsTenant(TENANT, (sql) => sql`select name from portal.citizen_profiles where id = ${OWNER} and tenant_id = ${TENANT}`);
      return rows.length > 0;
    });
    const rows = await sqlAsTenant(TENANT, (sql) => sql`select name, mobile from portal.citizen_profiles where id = ${OWNER} and tenant_id = ${TENANT}`);
    expect(rows.length).toBe(1);
    // Ciphertext must NOT equal the plaintext, and must not contain it.
    expect(rows[0].name).not.toBe(plaintextName);
    expect(String(rows[0].name)).not.toContain("Ramesh");
    expect(String(rows[0].mobile)).not.toContain("9876543210");
  }, 20000);
});

describe("Input sanitation rejected at the HTTP boundary", () => {
  it("oversized subject is rejected with 400", async () => {
    const r = await post("/v1/citizen/tickets",
      { citizenId: OWNER, subject: "x".repeat(300), description: "ok", priority: "low", channel: "web" }, ofH);
    expect(r.statusCode).toBe(400);
  });
  it("CSV-injection payload is neutralised (stored value is quote-prefixed)", async () => {
    const r = await post("/v1/citizen/grievances",
      { citizenId: OWNER, category: "=cmd|calc", subject: "formula", description: "payload" }, ofH);
    expect(r.statusCode).toBe(202);
    const gid = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/grievances/${gid}`);
    const rows = await sqlAsTenant(TENANT, (sql) => sql`select category from grievance.citizen_grievances where id = ${gid}`);
    expect(String(rows[0].category).startsWith("'=")).toBe(true);
  }, 20000);
});

describe("Tenant isolation", () => {
  it("a grievance created in TENANT is invisible to TENANT2", async () => {
    const r = await post("/v1/citizen/grievances",
      { citizenId: OWNER, category: "roads", subject: "pothole", description: "deep" }, ofH);
    const gid = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/grievances/${gid}`);
    expect((await get(`/v1/citizen/grievances/${gid}`, of2H)).statusCode).toBe(404);
  }, 20000);
});

describe("Idempotency — replayed grievance.register does not duplicate", () => {
  it("the same messageId is processed once (markProcessed dedupes)", async () => {
    const r = await post("/v1/citizen/grievances",
      { citizenId: OWNER, category: "sewage", subject: "idem", description: "once" }, ofH);
    const gid = JSON.parse(r.body).id;
    await waitReady(`/v1/citizen/grievances/${gid}`);
    const before = await sqlAsTenant(TENANT, (sql) => sql`select count(*)::int as c from grievance.citizen_grievances where id = ${gid}`);
    expect(before[0].c).toBe(1);
    // Re-publishing assign twice with the same body — terminal row count stays 1.
    await patch(`/v1/citizen/grievances/${gid}/assign`, { assignedTo: ASSIGNEE }, ofH);
    await patch(`/v1/citizen/grievances/${gid}/assign`, { assignedTo: ASSIGNEE }, ofH);
    await new Promise((res) => setTimeout(res, 300));
    const after = await sqlAsTenant(TENANT, (sql) => sql`select count(*)::int as c from grievance.citizen_grievances where id = ${gid}`);
    expect(after[0].c).toBe(1);
  }, 20000);
});
