/**
 * GAP-LEGAL-LIST-04 (owner decision #14): a small empanelled-advocate master (name, Bar enrolment
 * number, contact); cases link to an advocate and the lists show the advocate's name from the master.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { empanelledAdvocates } from "../src/modules/advocates/schema.js";
import { registerAdvocateConsumers } from "../src/modules/advocates/consumer.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { useFakeOrg, TEST_DEPT_ID } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000d1601";
const OTHER_TENANT = "11111111-aaaa-4000-8000-0000000d1602";
const ACTOR = "00000000-aaaa-4000-8000-0000000d1601";
const tok = (roles: string[], tenant = TENANT) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": tenant });
const asAdmin = () => tok(["legal_admin"]);
const asOfficer = () => tok(["legal_officer"]);
const asAuditor = () => tok(["audit_officer"]);
const drain = () => new Promise<void>((r) => setTimeout(r, 400));
const ADV = { name: "Adv. Kavita Rao", barEnrolmentNo: "D/1234/2011", contact: "9876543210" };

async function wipe(tenant: string): Promise<void> {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenant));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, tenant));
    await tx.delete(empanelledAdvocates).where(eq(empanelledAdvocates.tenantId, tenant));
  }));
  for (const r of ["case", "cases", "advocates"]) await cache.invalidateResource(tenant, r);
}

let app: FastifyInstance;
beforeAll(async () => {
  await wipe(TENANT); await wipe(OTHER_TENANT);
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerAdvocateConsumers(queue);
  registerCaseConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => { await wipe(TENANT); await wipe(OTHER_TENANT); useFakeOrg(); });
afterAll(async () => { await wipe(TENANT); await wipe(OTHER_TENANT); await app.close(); await sqlClient.end(); });

type Adv = { id: string; name: string; barEnrolmentNo: string; contact: string };
const create = (h: Record<string, string>, p: Record<string, unknown> = ADV) => app.inject({ method: "POST", url: "/v1/legal/advocates", headers: h, payload: p });
const list = async (h: Record<string, string>) => (await app.inject({ method: "GET", url: "/v1/legal/advocates", headers: h })).json() as { items: Adv[] };
async function seedAdvocate(): Promise<string> {
  const r = await create(asAdmin());
  expect(r.statusCode).toBe(202);
  await drain();
  return (r.json() as { id: string }).id;
}
const caseBody = (o: Record<string, unknown> = {}) => ({ caseNo: `WP/${Math.floor(Math.random() * 1e9)}/2026`, title: "T", courtCode: "hc_delhi", filingDate: "2026-03-01", departmentId: TEST_DEPT_ID, ...o });

describe("empanelled advocate master (decision #14)", () => {
  it("only the legal head (legal_admin / super_admin) manages it; officers and auditors cannot create", async () => {
    expect((await create(asOfficer())).statusCode).toBe(403);
    expect((await create(asAuditor())).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/legal/advocates", payload: ADV })).statusCode).toBe(401);
    expect((await create(asAdmin())).statusCode).toBe(202);
    expect((await create(tok(["super_admin"]), { ...ADV, barEnrolmentNo: "D/9/2000" })).statusCode).toBe(202);
  });

  it("validates name, Bar enrolment number and contact", async () => {
    expect((await create(asAdmin(), { ...ADV, name: "" })).statusCode).toBe(400);
    expect((await create(asAdmin(), { ...ADV, barEnrolmentNo: "??" })).statusCode).toBe(400);
    expect((await create(asAdmin(), { ...ADV, contact: "not a phone or email" })).statusCode).toBe(400);
    const { contact: _c, ...noContact } = ADV;
    expect((await create(asAdmin(), noContact)).statusCode).toBe(400);
  });

  it("persists the advocate with an audit event and rejects a duplicate Bar enrolment number (409)", async () => {
    const id = await seedAdvocate();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(empanelledAdvocates).where(eq(empanelledAdvocates.id, id)))))[0]!;
    expect(row.name).toBe(ADV.name);
    expect(row.barEnrolmentNo).toBe("D/1234/2011");
    expect(row.createdBy).toBe(ACTOR);
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(audits.some((a) => (a.payload as { resourceType?: string; action?: string }).resourceType === "advocate" && (a.payload as { action?: string }).action === "create")).toBe(true);
    const dup = await create(asAdmin(), { ...ADV, name: "Someone Else" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_BAR_ENROLMENT");
  });

  it("is tenant-scoped: another tenant neither sees it nor conflicts on the same Bar number", async () => {
    await seedAdvocate();
    expect((await list(tok(["legal_admin"], OTHER_TENANT))).items).toHaveLength(0);
    const r = await create(tok(["legal_admin"], OTHER_TENANT));
    expect(r.statusCode).toBe(202);
  });

  it("lists to readers; the contact is masked for everyone except the legal head", async () => {
    await seedAdvocate();
    expect((await list(asAdmin())).items[0]!.contact).toBe("9876543210");
    for (const h of [asOfficer(), asAuditor()]) {
      const c = (await list(h)).items[0]!.contact;
      expect(c).not.toBe("9876543210");
      expect(c.endsWith("10")).toBe(true);
      expect(c).toContain("•");
    }
    expect((await app.inject({ method: "GET", url: "/v1/legal/advocates", headers: tok(["citizen"]) })).statusCode).toBe(403);
  });
});

describe("cases show the advocate name from the master (decision #14)", () => {
  it("rejects an unknown advocateId (400 UNKNOWN_ADVOCATE)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: asOfficer(), payload: caseBody({ advocateId: "99999999-aaaa-4000-8000-0000000d16ff" }) });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNKNOWN_ADVOCATE");
  });

  it("links the advocate; list and detail return advocateId + the master's name (not the free text)", async () => {
    const advId = await seedAdvocate();
    const r = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: asOfficer(), payload: caseBody({ caseNo: "WP/ADV/2026", advocateId: advId, counselRef: "old free text" }) });
    expect(r.statusCode).toBe(202);
    await drain();
    const items = ((await app.inject({ method: "GET", url: "/v1/legal/cases", headers: asOfficer() })).json() as { items: Array<{ caseNo: string; advocateId?: string; advocateName?: string; counselRef?: string }> }).items;
    const c = items.find((i) => i.caseNo === "WP/ADV/2026")!;
    expect(c.advocateId).toBe(advId);
    expect(c.advocateName).toBe(ADV.name);
    expect(c.counselRef).toBe(ADV.name);
    const detail = (await app.inject({ method: "GET", url: `/v1/legal/cases/${(await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "WP/ADV/2026")))))[0]!.id}`, headers: asOfficer() })).json() as { advocateName?: string; advocateId?: string };
    expect(detail.advocateName).toBe(ADV.name);
    expect(detail.advocateId).toBe(advId);
  });

  it("a legacy case with only free-text counsel keeps showing that text", async () => {
    await app.inject({ method: "POST", url: "/v1/legal/cases", headers: asOfficer(), payload: caseBody({ caseNo: "WP/LEG/2026", counselRef: "Adv. Old Name" }) });
    await drain();
    const items = ((await app.inject({ method: "GET", url: "/v1/legal/cases", headers: asOfficer() })).json() as { items: Array<{ caseNo: string; advocateName?: string; counselRef?: string }> }).items;
    const c = items.find((i) => i.caseNo === "WP/LEG/2026")!;
    expect(c.counselRef).toBe("Adv. Old Name");
    expect(c.advocateName).toBe("Adv. Old Name");
  });
});
