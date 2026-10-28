/**
 * UAT DB-test defects (g2 #15-#17, #19-#22) — regression tests. Every item was a
 * "202/201/204 but nothing persisted" facade or an unreachable route; each test
 * drives the real HTTP route (or the published command) through the real
 * consumer and asserts the DATABASE row, plus the audit event, not the status
 * code alone.
 *
 * DB-backed against civitas_helpdesk (own disposable Postgres), mirroring
 * tests/ticket-actions-persistence.test.ts. HTTP -> shared in-memory queue ->
 * consumer -> DB.
 */
import { describe, it, expect, afterAll, beforeEach, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { ticketLinks } from "../src/modules/tickets/links-schema.js";
import { categories } from "../src/modules/config/categories-schema.js";
import { statusConfig } from "../src/modules/config/statuses-schema.js";
import { dispositions } from "../src/modules/config/dispositions-schema.js";
import { automationRules } from "../src/modules/automation/schema.js";
import { sanitationComplaints, sanitationFieldActions } from "../src/modules/sanitation/schema.js";
import { roadHotspots, roadHotspotLinks } from "../src/modules/road-hotspot/schema.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { registerConfigConsumers } from "../src/modules/config/consumer.js";
import { registerSanitationConsumers } from "../src/modules/sanitation/consumer.js";
import { registerRoadHotspotConsumers } from "../src/modules/road-hotspot/consumer.js";
import { registerAutomationConsumers } from "../src/modules/automation/consumer.js";
import { isValidTransition, getValidNextStatuses } from "../src/modules/tickets/itil-domain.js";
import * as automationQueries from "../src/modules/automation/queries.js";
import { COMMANDS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-0000000d0f01";
const OTHER_TENANT = "bbbbbbbb-0000-4000-8000-0000000d0f02";
const ACTOR = "00000000-aaaa-4000-8000-0000000d0f99";
const mq = queue as unknown as MemoryQueue;

function token(roles: string[] = ["helpdesk_admin"], tid = TENANT) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-uat" }, SECRET);
}
const auth = (roles?: string[], tid?: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

async function seedTicket(tenantId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id, tenantId, subject: `seed ${id}`, description: null, priority: "Medium", status: "open",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1, ...overrides,
      } as typeof tickets.$inferInsert),
    ),
  );
  return id;
}

const inTenant = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenantId, () => db.transaction(fn as never)) as Promise<T>;

async function ticketRow(id: string, tenantId = TENANT) {
  const rows = await inTenant(tenantId, (tx) => tx.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId))));
  return rows[0] ?? null;
}
async function auditFor(tenantId: string, action: string, resourceId: string) {
  const rows = await inTenant(tenantId, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId)));
  return rows
    .filter((r) => r.topic === "audit.event.record")
    .map((r) => r.payload as Record<string, unknown>)
    .filter((p) => p.action === action && p.resourceId === resourceId);
}

async function cleanup() {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await inTenant(tenantId, async (tx) => {
      await tx.delete(roadHotspotLinks).where(eq(roadHotspotLinks.tenantId, tenantId));
      await tx.delete(roadHotspots).where(eq(roadHotspots.tenantId, tenantId));
      await tx.delete(sanitationFieldActions).where(eq(sanitationFieldActions.tenantId, tenantId));
      await tx.delete(sanitationComplaints).where(eq(sanitationComplaints.tenantId, tenantId));
      await tx.delete(automationRules).where(eq(automationRules.tenantId, tenantId));
      await tx.delete(ticketLinks).where(eq(ticketLinks.tenantId, tenantId));
      await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
      await tx.delete(dispositions).where(eq(dispositions.tenantId, tenantId));
      await tx.delete(statusConfig).where(eq(statusConfig.tenantId, tenantId));
      // children before parents (parent_id FK)
      await tx.update(categories).set({ parentId: null }).where(eq(categories.tenantId, tenantId));
      await tx.delete(categories).where(eq(categories.tenantId, tenantId));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    });
  }
}

beforeAll(() => {
  registerTicketConsumers(queue);
  registerConfigConsumers(queue);
  registerSanitationConsumers(queue);
  registerRoadHotspotConsumers(queue);
  registerAutomationConsumers(queue);
});
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, roles?: string[], tid?: string) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: auth(roles, tid), ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  await mq.drain();
  return res;
}

// ── #15 ────────────────────────────────────────────────────────────────────
describe("#15 PATCH /v1/helpdesk/tickets/:id persists", () => {
  it("writes the changed fields, bumps version, audits", async () => {
    const id = await seedTicket(TENANT);
    const res = await call("PATCH", `/v1/helpdesk/tickets/${id}`, { subject: "New subject", priority: "High", description: "details" });
    expect(res.statusCode).toBe(202);
    const row = await ticketRow(id);
    expect(row!.subject).toBe("New subject");
    expect(row!.priority).toBe("High");
    expect(row!.description).toBe("details");
    expect(row!.version).toBe(2);
    expect((await auditFor(TENANT, "update", id)).some((a) => a.outcome === "success")).toBe(true);
  });

  it("does not touch fields that were not sent", async () => {
    const id = await seedTicket(TENANT, { description: "keep me", priority: "Low" });
    await call("PATCH", `/v1/helpdesk/tickets/${id}`, { subject: "only subject" });
    const row = await ticketRow(id);
    expect(row!.description).toBe("keep me");
    expect(row!.priority).toBe("Low");
  });

  it("redelivery of the same command applies once (markProcessed)", async () => {
    const id = await seedTicket(TENANT);
    const msg = {
      messageId: randomUUID(), type: COMMANDS.updateTicket, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { id: randomUUID(), tenantId: TENANT, ticketId: id, updates: { subject: "once" }, updatedBy: ACTOR },
    };
    await queue.publish(COMMANDS.updateTicket, msg);
    await mq.drain();
    await queue.publish(COMMANDS.updateTicket, msg);
    await mq.drain();
    expect((await ticketRow(id))!.version).toBe(2);
  });

  it("an unknown categoryId is dropped (audited) instead of poisoning the update", async () => {
    const id = await seedTicket(TENANT);
    await call("PATCH", `/v1/helpdesk/tickets/${id}`, { subject: "still applied", categoryId: randomUUID() });
    const row = await ticketRow(id);
    expect(row!.subject).toBe("still applied");
    expect(row!.categoryId).toBeNull();
    expect((await auditFor(TENANT, "update", id)).some((a) => String(a.outcome).startsWith("partial_fields_rejected:categoryId"))).toBe(true);
  });

  it("ticketType is only changed when the current status is valid for the new type", async () => {
    const assigned = await seedTicket(TENANT, { status: "assigned" });
    await call("PATCH", `/v1/helpdesk/tickets/${assigned}`, { ticketType: "problem" });
    expect((await ticketRow(assigned))!.ticketType).toBeNull();
    const open = await seedTicket(TENANT);
    await call("PATCH", `/v1/helpdesk/tickets/${open}`, { ticketType: "incident" });
    expect((await ticketRow(open))!.ticketType).toBe("incident");
  });

  it("tenant isolation: another tenant's ticket is not modified", async () => {
    const id = await seedTicket(OTHER_TENANT);
    const msg = {
      messageId: randomUUID(), type: COMMANDS.updateTicket, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { id: randomUUID(), tenantId: TENANT, ticketId: id, updates: { subject: "hijack" }, updatedBy: ACTOR },
    };
    await queue.publish(COMMANDS.updateTicket, msg);
    await mq.drain();
    expect((await ticketRow(id, OTHER_TENANT))!.subject).not.toBe("hijack");
    expect((await auditFor(TENANT, "update", id)).some((a) => a.outcome === "rejected_not_found")).toBe(true);
  });
});

// ── #16 ────────────────────────────────────────────────────────────────────
describe("#16 assigned incident can transition (full lifecycle)", () => {
  it("domain: assigned -> investigating is valid; assigned is not a transition target", () => {
    expect(isValidTransition("incident", "assigned", "investigating")).toBe(true);
    expect(getValidNextStatuses("incident", "assigned")).toEqual(["investigating"]);
    expect(isValidTransition("incident", "assigned", "closed")).toBe(false);
    expect(isValidTransition("incident", "assigned", "resolved")).toBe(false);
    expect(isValidTransition("incident", "open", "assigned")).toBe(false);
  });

  it("typed incident: open -> assign -> investigating -> resolved -> closed all persist", async () => {
    const id = await seedTicket(TENANT, { ticketType: "incident", typeFields: { impactLevel: "high", urgency: "high" } });
    const agent = randomUUID();
    let res = await call("POST", `/v1/helpdesk/tickets/${id}/assign`, { assigneeId: agent });
    expect(res.statusCode).toBe(202);
    expect((await ticketRow(id))!.status).toBe("assigned");

    for (const next of ["investigating", "resolved", "closed"]) {
      res = await call("POST", `/v1/helpdesk/tickets/${id}/transition`, { status: next });
      expect(res.statusCode, `transition to ${next}`).toBe(202);
      expect((await ticketRow(id))!.status).toBe(next);
    }
    expect((await ticketRow(id))!.resolvedAt).not.toBeNull();
  });

  it("assigning a non-open ticket keeps its workflow status (no silent regress)", async () => {
    const id = await seedTicket(TENANT, { ticketType: "incident", status: "investigating" });
    await call("POST", `/v1/helpdesk/tickets/${id}/assign`, { assigneeId: randomUUID() });
    const row = await ticketRow(id);
    expect(row!.status).toBe("investigating");
    expect(row!.assigneeId).not.toBeNull();
  });
});

// ── #17 ────────────────────────────────────────────────────────────────────
describe("#17 DELETE /tickets/:id/links/:linkId removes the link", () => {
  async function seedLink(tenantId = TENANT) {
    const a = await seedTicket(tenantId);
    const b = await seedTicket(tenantId);
    const linkId = randomUUID();
    await inTenant(tenantId, (tx) => tx.insert(ticketLinks).values({
      id: linkId, tenantId, sourceTicketId: a, targetTicketId: b, linkType: "related", createdBy: ACTOR,
    }));
    return { a, b, linkId };
  }
  const links = (tenantId = TENANT) => inTenant(tenantId, (tx) => tx.select().from(ticketLinks).where(eq(ticketLinks.tenantId, tenantId)));

  it("deletes the row and audits it", async () => {
    const { a, linkId } = await seedLink();
    const res = await call("DELETE", `/v1/helpdesk/tickets/${a}/links/${linkId}`);
    expect(res.statusCode).toBe(204);
    expect(await links()).toHaveLength(0);
    expect((await auditFor(TENANT, "unlink", linkId)).some((x) => x.outcome === "success")).toBe(true);
  });

  it("works from the target ticket's URL too", async () => {
    const { b, linkId } = await seedLink();
    await call("DELETE", `/v1/helpdesk/tickets/${b}/links/${linkId}`);
    expect(await links()).toHaveLength(0);
  });

  it("a link of a different ticket cannot be deleted through an unrelated ticket's URL", async () => {
    const { linkId } = await seedLink();
    const unrelated = await seedTicket(TENANT);
    await call("DELETE", `/v1/helpdesk/tickets/${unrelated}/links/${linkId}`);
    expect(await links()).toHaveLength(1);
    expect((await auditFor(TENANT, "unlink", linkId)).some((x) => x.outcome === "rejected_not_found")).toBe(true);
  });

  it("another tenant cannot delete the link", async () => {
    const { a, linkId } = await seedLink();
    await call("DELETE", `/v1/helpdesk/tickets/${a}/links/${linkId}`, undefined, ["helpdesk_admin"], OTHER_TENANT);
    expect(await links()).toHaveLength(1);
  });
});

// ── #19 ────────────────────────────────────────────────────────────────────
describe("#19 config masters persist", () => {
  it("categories: POST creates a row, PATCH updates it, GET lists it", async () => {
    const created = await call("POST", "/v1/helpdesk/config/categories", { name: "Network", ordinal: 2 });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    let rows = await inTenant(TENANT, (tx) => tx.select().from(categories).where(eq(categories.id, id)));
    expect(rows[0]).toMatchObject({ name: "Network", ordinal: 2, enabled: true, parentId: null });

    const patched = await call("PATCH", `/v1/helpdesk/config/categories/${id}`, { name: "Networking", enabled: false });
    expect(patched.statusCode).toBe(200);
    rows = await inTenant(TENANT, (tx) => tx.select().from(categories).where(eq(categories.id, id)));
    expect(rows[0]).toMatchObject({ name: "Networking", enabled: false, version: 2 });

    const listed = await call("GET", "/v1/helpdesk/config/categories");
    expect(listed.json().data.map((c: { id: string }) => c.id)).toContain(id);
    expect((await auditFor(TENANT, "category_create", id))).toHaveLength(1);
  });

  it("categories: a child with a real parent is stored; a missing/self parent is rejected, not thrown", async () => {
    const parent = (await call("POST", "/v1/helpdesk/config/categories", { name: "Parent" })).json().data.id as string;
    const child = (await call("POST", "/v1/helpdesk/config/categories", { name: "Child", parentId: parent })).json().data.id as string;
    const rows = await inTenant(TENANT, (tx) => tx.select().from(categories).where(eq(categories.id, child)));
    expect(rows[0]!.parentId).toBe(parent);

    const orphan = (await call("POST", "/v1/helpdesk/config/categories", { name: "Orphan", parentId: randomUUID() })).json().data.id as string;
    expect(await inTenant(TENANT, (tx) => tx.select().from(categories).where(eq(categories.id, orphan)))).toHaveLength(0);
    expect((await auditFor(TENANT, "category_create", orphan))[0]!.outcome).toBe("rejected_parent_not_found");

    await call("PATCH", `/v1/helpdesk/config/categories/${parent}`, { parentId: parent });
    expect((await auditFor(TENANT, "category_update", parent))[0]!.outcome).toBe("rejected_invalid_parent");
  });

  it("statuses: POST creates, PATCH updates, GET lists", async () => {
    const created = await call("POST", "/v1/helpdesk/config/statuses", { name: "Waiting", color: "#FF5500", canonicalState: "pending", ordinal: 3 });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    await call("PATCH", `/v1/helpdesk/config/statuses/${id}`, { color: "#00FF00", canonicalState: "resolved" });
    const rows = await inTenant(TENANT, (tx) => tx.select().from(statusConfig).where(eq(statusConfig.id, id)));
    expect(rows[0]).toMatchObject({ name: "Waiting", color: "#00FF00", canonicalState: "resolved", ordinal: 3, version: 2 });
    const listed = await call("GET", "/v1/helpdesk/config/statuses");
    expect(listed.json().data.map((c: { id: string }) => c.id)).toContain(id);
  });

  it("dispositions: POST creates and GET lists", async () => {
    const created = await call("POST", "/v1/helpdesk/config/dispositions", { label: "Resolved - no action", category: "closure" });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    const rows = await inTenant(TENANT, (tx) => tx.select().from(dispositions).where(eq(dispositions.id, id)));
    expect(rows[0]).toMatchObject({ label: "Resolved - no action", category: "closure", enabled: true });
    const listed = await call("GET", "/v1/helpdesk/config/dispositions");
    expect(listed.json().data.map((c: { id: string }) => c.id)).toContain(id);
  });

  it("tenant isolation: another tenant's list does not include the row", async () => {
    await call("POST", "/v1/helpdesk/config/dispositions", { label: "Mine" });
    const other = await call("GET", "/v1/helpdesk/config/dispositions", undefined, ["helpdesk_admin"], OTHER_TENANT);
    expect(other.json().data).toHaveLength(0);
  });
});

// ── #20 ────────────────────────────────────────────────────────────────────
describe("#20 sanitation routes are registered and persist", () => {
  const loc = { lat: 12.9, lng: 77.6, ward: "W1", zone: "Z1" };
  const AGENT = ["helpdesk_agent"];

  it("registers all sanitation routes (no more 404)", async () => {
    for (const [method, url] of [
      ["GET", "/v1/helpdesk/sanitation/complaints"],
      ["GET", "/v1/helpdesk/sanitation/field-actions"],
    ] as const) {
      const res = await call(method, url, undefined, ["helpdesk_admin"]);
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("full lifecycle: create -> acknowledge -> assign -> field action -> resolve -> reopen", async () => {
    const created = await call("POST", "/v1/helpdesk/sanitation/complaints", { location: loc, complaintType: "overflowing_bin", description: "bin" }, ["citizen"]);
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    const get = async () => (await inTenant(TENANT, (tx) => tx.select().from(sanitationComplaints).where(eq(sanitationComplaints.id, id))))[0]!;

    let row = await get();
    expect(row).toMatchObject({ status: "reported", complaintType: "overflowing_bin", severity: "medium", reportedBy: ACTOR });
    expect(row.complaintNumber).toMatch(/^SAN-\d{8}-[0-9A-F]{8}$/);

    expect((await call("POST", `/v1/helpdesk/sanitation/complaints/${id}/acknowledge`, {}, AGENT)).statusCode).toBe(202);
    expect((await get()).status).toBe("acknowledged");

    const worker = randomUUID();
    await call("POST", `/v1/helpdesk/sanitation/complaints/${id}/assign`, { assignedTo: worker }, AGENT);
    row = await get();
    expect(row).toMatchObject({ status: "assigned", assignedTo: worker });
    expect(row.assignedAt).not.toBeNull();

    const fa = await call("POST", "/v1/helpdesk/sanitation/field-actions", { complaintId: id, actionType: "cleaning", notes: "done", durationMinutes: 20 }, AGENT);
    expect(fa.statusCode).toBe(202);
    const actions = await inTenant(TENANT, (tx) => tx.select().from(sanitationFieldActions).where(eq(sanitationFieldActions.complaintId, id)));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionType: "cleaning", durationMinutes: 20, performedBy: ACTOR });
    expect((await get()).status).toBe("in_progress");

    await call("POST", `/v1/helpdesk/sanitation/complaints/${id}/resolve`, { resolution: "cleared" }, AGENT);
    row = await get();
    expect(row).toMatchObject({ status: "resolved", resolution: "cleared" });
    expect(row.resolvedAt).not.toBeNull();

    await call("POST", `/v1/helpdesk/sanitation/complaints/${id}/reopen`, { reason: "again" }, ["citizen"]);
    row = await get();
    expect(row).toMatchObject({ status: "reopened", reopenCount: 1 });
    expect((await auditFor(TENANT, "complaint_reopen", id))[0]!.reason).toBe("again");

    const listed = await call("GET", "/v1/helpdesk/sanitation/complaints?status=reopened", undefined, ["helpdesk_admin"]);
    expect(listed.json().data.map((c: { id: string }) => c.id)).toContain(id);
  });

  it("redelivered create does not duplicate; two complaints get distinct numbers", async () => {
    const mk = () => ({
      messageId: randomUUID(), type: COMMANDS.sanitationComplaintCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
    });
    const id = randomUUID();
    const msg = { ...mk(), payload: { id, tenantId: TENANT, reportedBy: ACTOR, location: loc, complaintType: "no_water", severity: "low" } };
    await queue.publish(COMMANDS.sanitationComplaintCreate, msg);
    await queue.publish(COMMANDS.sanitationComplaintCreate, msg);
    const id2 = randomUUID();
    await queue.publish(COMMANDS.sanitationComplaintCreate, { ...mk(), payload: { id: id2, tenantId: TENANT, reportedBy: ACTOR, location: loc, complaintType: "no_water", severity: "low" } });
    await mq.drain();
    const rows = await inTenant(TENANT, (tx) => tx.select().from(sanitationComplaints).where(eq(sanitationComplaints.tenantId, TENANT)));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.complaintNumber)).size).toBe(2);
  });

  it("a stale command is audited as rejected and changes nothing (resolve on a reported complaint)", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.sanitationComplaintCreate, {
      messageId: randomUUID(), type: COMMANDS.sanitationComplaintCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: TENANT, reportedBy: ACTOR, location: loc, complaintType: "foul_odour", severity: "low" },
    });
    await queue.publish(COMMANDS.sanitationComplaintResolve, {
      messageId: randomUUID(), type: COMMANDS.sanitationComplaintResolve, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: TENANT, resolution: "x" },
    });
    await mq.drain();
    const row = (await inTenant(TENANT, (tx) => tx.select().from(sanitationComplaints).where(eq(sanitationComplaints.id, id))))[0]!;
    expect(row.status).toBe("reported");
    expect((await auditFor(TENANT, "complaint_resolve", id))[0]!.outcome).toBe("rejected_not_in_progress");
  });
});

// ── #21 ────────────────────────────────────────────────────────────────────
describe("#21 road hotspots persist", () => {
  const location = { lat: 12.9, lng: 77.6, ward: "W1", zone: "Z1", road_name: "MG Road" };
  const get = async (id: string) => (await inTenant(TENANT, (tx) => tx.select().from(roadHotspots).where(eq(roadHotspots.id, id))))[0]!;

  it("POST creates the hotspot with code + computed risk score; dependent routes then work", async () => {
    const created = await call("POST", "/v1/helpdesk/road-hotspots", { location, category: "pothole", complaintCount: 4, lastComplaintAt: new Date().toISOString() }, ["helpdesk_agent"]);
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    const row = await get(id);
    expect(row).toMatchObject({ category: "pothole", complaintCount: 4, status: "identified", location });
    expect(row.hotspotCode).toMatch(/^RH-\d{8}-[0-9A-F]{8}$/);
    expect(row.riskScore).toBeGreaterThan(40); // 20 freq + 20 category + recency

    const byId = await call("GET", `/v1/helpdesk/road-hotspots/${id}`, undefined, ["helpdesk_agent"]);
    expect(byId.statusCode).toBe(200);

    const ticket = await seedTicket(TENANT);
    const link = await call("POST", `/v1/helpdesk/road-hotspots/${id}/link-ticket`, { ticketId: ticket }, ["helpdesk_agent"]);
    expect(link.statusCode).toBe(202);
    const links = await inTenant(TENANT, (tx) => tx.select().from(roadHotspotLinks).where(eq(roadHotspotLinks.hotspotId, id)));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ ticketId: ticket, linkedBy: ACTOR });
    const linked = await call("GET", `/v1/helpdesk/road-hotspots/${id}/linked-tickets`, undefined, ["helpdesk_agent"]);
    expect(linked.json().data).toHaveLength(1);

    // linking the same ticket again is a no-op
    await call("POST", `/v1/helpdesk/road-hotspots/${id}/link-ticket`, { ticketId: ticket }, ["helpdesk_agent"]);
    expect(await inTenant(TENANT, (tx) => tx.select().from(roadHotspotLinks).where(eq(roadHotspotLinks.hotspotId, id)))).toHaveLength(1);

    await call("POST", `/v1/helpdesk/road-hotspots/${id}/plan-maintenance`, { maintenancePlanRef: "PLAN-77" }, ["helpdesk_agent"]);
    expect(await get(id)).toMatchObject({ status: "maintenance_planned", maintenancePlanRef: "PLAN-77" });
  });

  it("linking a ticket that does not exist in the tenant is rejected, not stored", async () => {
    const id = (await call("POST", "/v1/helpdesk/road-hotspots", { location, category: "drainage" }, ["helpdesk_agent"])).json().id as string;
    const foreign = await seedTicket(OTHER_TENANT);
    await call("POST", `/v1/helpdesk/road-hotspots/${id}/link-ticket`, { ticketId: foreign }, ["helpdesk_agent"]);
    expect(await inTenant(TENANT, (tx) => tx.select().from(roadHotspotLinks).where(eq(roadHotspotLinks.hotspotId, id)))).toHaveLength(0);
    expect((await auditFor(TENANT, "hotspot_link_ticket", id)).some((a) => a.outcome === "rejected_ticket_not_found")).toBe(true);
  });

  it("resolve is guarded: only a work_in_progress hotspot resolves", async () => {
    const id = (await call("POST", "/v1/helpdesk/road-hotspots", { location, category: "cave_in" }, ["helpdesk_agent"])).json().id as string;
    await queue.publish(COMMANDS.roadHotspotResolve, {
      messageId: randomUUID(), type: COMMANDS.roadHotspotResolve, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT, hotspotId: id },
    });
    await mq.drain();
    expect((await get(id)).status).toBe("identified");
    expect((await auditFor(TENANT, "hotspot_resolve", id))[0]!.outcome).toBe("rejected_not_in_progress");

    await inTenant(TENANT, (tx) => tx.update(roadHotspots).set({ status: "work_in_progress" }).where(eq(roadHotspots.id, id)));
    const res = await call("POST", `/v1/helpdesk/road-hotspots/${id}/resolve`, {}, ["helpdesk_agent"]);
    expect(res.statusCode).toBe(202);
    const row = await get(id);
    expect(row.status).toBe("resolved");
    expect(row.resolvedAt).not.toBeNull();
  });
});

// ── #22 ────────────────────────────────────────────────────────────────────
describe("#22 deleted automation rule is not returned", () => {
  it("GET /automation/rules/:id is 404 after delete; queries.getRule returns null", async () => {
    const created = await call("POST", "/v1/helpdesk/automation/rules", {
      name: "r1", ordinal: 1, trigger: { type: "field_match", field: "priority", value: "high" }, actions: [{ type: "assign", to: ACTOR }],
    });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    expect((await call("GET", `/v1/helpdesk/automation/rules/${id}`)).statusCode).toBe(200);

    await call("DELETE", `/v1/helpdesk/automation/rules/${id}`);
    expect((await call("GET", `/v1/helpdesk/automation/rules/${id}`)).statusCode).toBe(404);
    expect(await automationQueries.getRule(TENANT, id)).toBeNull();
    // soft delete: the row is still there for audit/history
    expect(await inTenant(TENANT, (tx) => tx.select().from(automationRules).where(eq(automationRules.id, id)))).toHaveLength(1);
  });
});
