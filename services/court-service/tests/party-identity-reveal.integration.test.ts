/**
 * GAP-COURT-CASES-CASEID-04 (owner decision #32): judges, registrars and court staff see full party and
 * advocate identity; others see it masked; EVERY reveal emits a court audit event, and a reveal that
 * cannot be audited is refused (fail closed). Real DB (RLS), real consumer, real PII encryption.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { caseParties } from "../src/modules/case-registry/schema.js";
import { registerPartyConsumers } from "../src/modules/party/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const OTHER = randomUUID();
const CASE_ID = randomUUID();
const P1 = randomUUID();
const P2 = randomUUID();
const REVEAL_TOPIC = "court.party.reveal_audit";
const ACTOR = randomUUID();

const hdr = (roles: string[], tid = T, actor = ACTOR) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid, roles, sid: "s-d32" }, SECRET, 3600)}`,
  "x-tenant-id": tid,
});

let app: FastifyInstance;
let q: Queue;

async function cleanup() {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    await sql`DELETE FROM court.case_parties WHERE tenant_id = ${T}`;
    await sql`DELETE FROM court.cases WHERE tenant_id = ${T}`;
    await sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    await sql`INSERT INTO court.cases (id, tenant_id, cnr_number, case_type, status, title)
      VALUES (${CASE_ID}, ${T}, ${"CNR-" + CASE_ID.slice(0, 8)}, 'civil', 'filed', 'Sharma v State')`;
  });
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.insert(caseParties).values([
      { id: P1, tenantId: T, caseId: CASE_ID, partyRole: "petitioner", nameEnc: "Ramesh Kumar Sharma", addressEnc: "12 MG Road, Lucknow",
        phoneEnc: "9876543210", emailEnc: "ramesh@example.com", advocateName: "Adv. Priya Singh", advocateBarId: "UP/1234/2010" },
      { id: P2, tenantId: T, caseId: CASE_ID, partyRole: "respondent", nameEnc: "State of UP", advocateName: null, advocateBarId: null },
    ]);
  }));
  q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  registerPartyConsumers((topic, handler) => (q.subscribe as unknown as (t: string, h: unknown) => void)(topic, handler));
  await q.start();
});
afterAll(async () => {
  await q.stop();
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const partiesUrl = `/v1/court/cases/${CASE_ID}/parties`;
const caseUrl = `/v1/court/cases/${CASE_ID}`;
type P = { id: string; name: string | null; advocateName: string | null; advocateBarId: string | null; address: string | null; phone: string | null };

describe("party identity reveal (owner decision #32)", () => {
  it.each([["judge"], ["registrar"], ["court_admin"]])("%s sees the full name, advocate name and Bar ID", async (role) => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({ method: "GET", url: partiesUrl, headers: hdr([role]) });
    expect(res.statusCode).toBe(200);
    const p1 = (res.json().items as P[]).find((p) => p.id === P1)!;
    expect(p1).toMatchObject({ name: "Ramesh Kumar Sharma", advocateName: "Adv. Priya Singh", advocateBarId: "UP/1234/2010" });
    expect(res.json().identityRevealed).toBe(true);
    spy.mockRestore();
  });

  it("F12: super_admin is NOT an identity-reveal role - sees masked values and no reveal is audited", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["super_admin"]) });
    const p1 = (res.json().items as P[]).find((p) => p.id === P1)!;
    expect(res.json().identityRevealed).toBe(false);
    expect(p1.name).toBe("R*** K*** S***");
    expect(p1.advocateBarId).toBe("********2010");
    expect(spy.mock.calls.filter((c) => c[0] === REVEAL_TOPIC)).toHaveLength(0);
    spy.mockRestore();
  });

  it("a registrar sees identity but NOT address / full phone (those stay with judge / court_admin)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const p1 = ((await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["registrar"]) })).json().items as P[]).find((p) => p.id === P1)!;
    expect(p1.address).toBeNull();
    expect(p1.phone).not.toBe("9876543210");
    spy.mockRestore();
  });

  it("a court_clerk sees masked name, advocate name and Bar ID on both endpoints, and no reveal is audited", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const listRes = (await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["court_clerk"]) })).json();
    const embedRes = (await app.inject({ method: "GET", url: caseUrl, headers: hdr(["court_clerk"]) })).json();
    expect(listRes.identityRevealed).toBe(false);
    expect(embedRes.identityRevealed).toBe(false);
    const list = listRes.items as P[];
    const embed = embedRes.parties as P[];
    for (const items of [list, embed]) {
      const p1 = items.find((p) => p.id === P1)!;
      expect(p1.name).toBe("R*** K*** S***");
      expect(p1.advocateName).toBe("A*** P*** S***");
      expect(p1.advocateBarId).toBe("********2010");
      expect(JSON.stringify(items)).not.toMatch(/Ramesh|1234|Priya/);
    }
    expect(spy.mock.calls.filter((c) => c[0] === REVEAL_TOPIC)).toHaveLength(0);
    spy.mockRestore();
  });

  it("every reveal (list AND case embed) publishes one audit command naming the case, parties and fields - never the values", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["judge"]) });
    await app.inject({ method: "GET", url: caseUrl, headers: hdr(["registrar"]) });
    const calls = spy.mock.calls.filter((c) => c[0] === REVEAL_TOPIC);
    expect(calls).toHaveLength(2);
    const payload = calls[0]![1].payload as { caseId: string; parties: Array<{ id: string; fields: string[] }>; surface: string; roles: string[] };
    expect(payload.caseId).toBe(CASE_ID);
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...payload.parties].sort(byId)).toEqual(
      [{ id: P1, fields: ["name", "advocateName", "advocateBarId"] }, { id: P2, fields: ["name"] }].sort(byId),
    );
    expect(payload.surface).toBe("case_parties");
    expect(JSON.stringify(calls)).not.toMatch(/Ramesh|1234|Priya/);
    expect((calls[1]![1].payload as { surface: string }).surface).toBe("case_detail");
    expect(calls[0]![1].tenantId).toBe(T);
    spy.mockRestore();
  });

  it("fails closed: if the reveal cannot be audited, no identity is returned (503)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockRejectedValue(new Error("queue down"));
    const res = await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["judge"]) });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatch(/Ramesh|1234|Priya/);
    spy.mockRestore();
  });

  it("a role outside the court read roles still gets 403, and another tenant sees nothing", async () => {
    expect((await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["citizen"]) })).statusCode).toBe(403);
    const other = await app.inject({ method: "GET", url: partiesUrl, headers: hdr(["judge"], OTHER) });
    expect(other.statusCode).toBe(200);
    expect(other.json().items).toEqual([]);
  });

  it("the audit consumer writes ONE court audit event per command (redelivery is a no-op)", async () => {
    const messageId = randomUUID();
    const publish = () => q.publish(REVEAL_TOPIC, {
      messageId, type: REVEAL_TOPIC, tenantId: T, actorId: ACTOR, correlationId: "corr-reveal", schemaVersion: "1.0",
      payload: { caseId: CASE_ID, surface: "case_parties", roles: ["judge"], parties: [{ id: P1, fields: ["name", "advocateBarId"] }] },
    });
    await publish();
    await publish();
    await new Promise((r) => setTimeout(r, 800));
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      return sql`SELECT actor_id, payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'audit.event.record' AND payload->>'action' = 'party_identity_revealed'`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(ACTOR);
    expect(rows[0]!.payload).toMatchObject({ service: "court", resourceType: "case", resourceId: CASE_ID, outcome: "success" });
    expect(JSON.stringify(rows[0]!.payload)).toContain(P1);
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/Ramesh|1234/);
  });
});
