/**
 * consent-based inter-department data exchange hub — REAL round-trip tests
 * (SVC-150). Requests/grants/denies/revokes are driven through the real
 * consumers; fetches go through the synchronous enforced path; everything is
 * read back through the RLS-scoped repo. Proves: valid fetch succeeds + is
 * logged; out-of-window / purpose / category fetches are denied; revoke blocks
 * future fetch; one-time consent is single-use; cross-tenant RLS isolation;
 * the access ledger is append-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { consentArtefacts, consentHoldings, consentLedger } from "../src/modules/consent-exchange/schema.js";
import { registerConsentExchangeConsumers } from "../src/modules/consent-exchange/consumer.js";
import { evaluateFetch } from "../src/modules/consent-exchange/policy.js";
import * as repo from "../src/modules/consent-exchange/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-0000000001a0";
const T2 = "aaaaaaaa-1111-4000-8000-0000000001a1";
const ACTOR = "cccccccc-3333-4000-8000-0000000001a0";
const token = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["tenant_admin", "platform_admin"], sid: "s1" }, SECRET);

const HOUR = 3600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    // ledger is append-only (no DELETE via trigger) → drop the trigger's guard
    // by truncating as owner is not possible here; delete artefacts/holdings and
    // leave ledger rows (each test uses fresh principal ids so they never clash).
    await tx.delete(consentHoldings).where(eq(consentHoldings.tenantId, tenantId));
    await tx.delete(consentArtefacts).where(eq(consentArtefacts.tenantId, tenantId));
  }));
}

async function publish(q: MemoryQueue, topic: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
  await q.drain();
}

function q(): MemoryQueue { const mq = new MemoryQueue(); registerConsentExchangeConsumers(mq); return mq; }

async function seed(mq: MemoryQueue, tenantId: string, opts: {
  principalId: string; categories: string[]; frequency?: string; validFrom?: string; validTo?: string; purposeKey?: string;
}): Promise<string> {
  const id = randomUUID();
  await publish(mq, "tenant.consent.request", tenantId, {
    id, tenantId, principalId: opts.principalId, requestingDept: "Revenue", providingDept: "Registrar",
    purposeKey: opts.purposeKey ?? "property-tax-assessment", dataCategories: opts.categories,
    validFrom: opts.validFrom ?? iso(-HOUR), validTo: opts.validTo ?? iso(HOUR), frequency: opts.frequency ?? "recurring",
  });
  return id;
}

async function grant(mq: MemoryQueue, tenantId: string, id: string): Promise<void> {
  await publish(mq, "tenant.consent.grant", tenantId, { id, tenantId });
}

async function holding(mq: MemoryQueue, tenantId: string, principalId: string, category: string, value: Record<string, unknown>): Promise<void> {
  await publish(mq, "tenant.consent.holding.upsert", tenantId, { id: randomUUID(), tenantId, principalId, providingDept: "Registrar", category, value });
}

async function inject(m: string, u: string, tid?: string, p?: unknown): Promise<{ status: number; body: any }> {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (tid) o.headers = { authorization: `Bearer ${token(tid)}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

const fetchReq = (tenantId: string, id: string, purposeKey: string, categories: string[]) =>
  repo.performFetch(tenantId, id, { purposeKey, categories }, { actorId: ACTOR, correlationId: `c-${randomUUID()}` });

describe("consent exchange hub — real persistence (SVC-150)", () => {
  beforeAll(async () => { await wipe(T1); await wipe(T2); });
  afterAll(async () => { await wipe(T1); await wipe(T2); await sqlClient.end(); });

  it("valid consent: request -> grant -> fetch returns in-scope data and is logged", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    await holding(mq, T1, principal, "address", { line1: "12 MG Road", city: "Bengaluru" });
    await holding(mq, T1, principal, "phone", { number: "+91-99999" });
    const id = await seed(mq, T1, { principalId: principal, categories: ["address", "phone"] });
    await grant(mq, T1, id);
    await mq.stop();

    const res = await fetchReq(T1, id, "property-tax-assessment", ["address"]);
    expect(res.allowed).toBe(true);
    if (!res.allowed) throw new Error("unreachable");
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.category).toBe("address");
    expect((res.data[0]?.value as { city: string }).city).toBe("Bengaluru");

    const ledger = await repo.listLedgerByPrincipal(T1, principal);
    const kinds = ledger.map((l) => `${l.eventType}:${l.outcome}`);
    expect(kinds).toContain("request:recorded");
    expect(kinds).toContain("grant:recorded");
    expect(kinds).toContain("fetch:allowed");
  });

  it("fetch is denied outside the validity window", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    // window already elapsed
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"], validFrom: iso(-2 * HOUR), validTo: iso(-HOUR) });
    await grant(mq, T1, id);
    await mq.stop();
    const res = await fetchReq(T1, id, "property-tax-assessment", ["address"]);
    expect(res).toEqual({ allowed: false, reason: "WINDOW_EXPIRED" });
    const denied = (await repo.listLedgerByPrincipal(T1, principal)).find((l) => l.eventType === "fetch");
    expect(denied?.outcome).toBe("denied");
    expect(denied?.reason).toBe("WINDOW_EXPIRED");
  });

  it("fetch is denied for a purpose the consent does not cover", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await grant(mq, T1, id);
    await mq.stop();
    const res = await fetchReq(T1, id, "marketing", ["address"]);
    expect(res).toEqual({ allowed: false, reason: "PURPOSE_MISMATCH" });
  });

  it("fetch is denied for categories outside the consented scope", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await grant(mq, T1, id);
    await mq.stop();
    const res = await fetchReq(T1, id, "property-tax-assessment", ["income"]);
    expect(res).toEqual({ allowed: false, reason: "CATEGORY_OUT_OF_SCOPE" });
  });

  it("fetch before grant is denied (NOT_GRANTED)", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await mq.stop();
    const res = await fetchReq(T1, id, "property-tax-assessment", ["address"]);
    expect(res).toEqual({ allowed: false, reason: "NOT_GRANTED" });
  });

  it("revoke blocks all future fetches", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    await holding(mq, T1, principal, "address", { line1: "x" });
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await grant(mq, T1, id);
    // one good fetch first
    expect((await fetchReq(T1, id, "property-tax-assessment", ["address"])).allowed).toBe(true);
    await publish(mq, "tenant.consent.revoke", T1, { id, tenantId: T1 });
    await mq.stop();
    const res = await fetchReq(T1, id, "property-tax-assessment", ["address"]);
    expect(res).toEqual({ allowed: false, reason: "REVOKED" });
    const a = await repo.findArtefact(T1, id);
    expect(a?.status).toBe("revoked");
  });

  it("one-time consent is single-use (second fetch expired)", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    await holding(mq, T1, principal, "address", { line1: "y" });
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"], frequency: "one-time" });
    await grant(mq, T1, id);
    await mq.stop();
    expect((await fetchReq(T1, id, "property-tax-assessment", ["address"])).allowed).toBe(true);
    const second = await fetchReq(T1, id, "property-tax-assessment", ["address"]);
    expect(second).toEqual({ allowed: false, reason: "EXPIRED" });
    expect((await repo.findArtefact(T1, id))?.fetchCount).toBe(1);
  });

  it("recurring consent allows repeated fetches within the window", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    await holding(mq, T1, principal, "address", { line1: "z" });
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"], frequency: "recurring" });
    await grant(mq, T1, id);
    await mq.stop();
    expect((await fetchReq(T1, id, "property-tax-assessment", ["address"])).allowed).toBe(true);
    expect((await fetchReq(T1, id, "property-tax-assessment", ["address"])).allowed).toBe(true);
    expect((await repo.findArtefact(T1, id))?.fetchCount).toBe(2);
  });

  it("deny transitions the artefact to denied and fetch is refused", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await publish(mq, "tenant.consent.deny", T1, { id, tenantId: T1, reason: "principal declined" });
    await mq.stop();
    expect((await repo.findArtefact(T1, id))?.status).toBe("denied");
    expect(await fetchReq(T1, id, "property-tax-assessment", ["address"])).toEqual({ allowed: false, reason: "DENIED" });
  });

  it("enforces cross-tenant isolation (FORCED RLS)", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id1 = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await grant(mq, T1, id1);
    await mq.stop();
    // T2 cannot see or fetch T1's artefact
    expect(await repo.findArtefact(T2, id1)).toBeUndefined();
    expect(await fetchReq(T2, id1, "property-tax-assessment", ["address"])).toEqual({ allowed: false, reason: "NOT_FOUND" });
    const t2List = await repo.listArtefacts(T2, { principalId: principal });
    expect(t2List.map((a) => a.id)).not.toContain(id1);
  });

  it("access ledger is append-only (UPDATE/DELETE rejected)", async () => {
    const mq = q(); await mq.start();
    const principal = randomUUID();
    const id = await seed(mq, T1, { principalId: principal, categories: ["address"] });
    await mq.stop();
    const rows = await repo.listLedgerByPrincipal(T1, principal);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const lid = rows[0]!.id;
    await expect(
      runWithTenant(T1, () => db.transaction((tx) => tx.update(consentLedger).set({ reason: "tampered" }).where(eq(consentLedger.id, lid)))),
    ).rejects.toThrow(/append-only/i);
    await expect(
      runWithTenant(T1, () => db.transaction((tx) => tx.delete(consentLedger).where(eq(consentLedger.id, lid)))),
    ).rejects.toThrow(/append-only/i);
  });

  it("HTTP: full lifecycle over the API + auth/validation guards", async () => {
    // Wire the shared command bus to the consumers (in a running service the
    // worker process does this); drain() after each command applies the write.
    registerConsentExchangeConsumers(infraQueue);
    await infraQueue.start();
    const principal = randomUUID();
    // 401 unauthenticated
    expect((await inject("GET", "/v1/consent/requests")).status).toBe(401);
    // 400 invalid window (validTo before validFrom)
    const badWindow = await inject("POST", "/v1/consent/requests", T1, {
      principalId: principal, requestingDept: "Revenue", providingDept: "Registrar", purposeKey: "p",
      dataCategories: ["address"], validFrom: iso(HOUR), validTo: iso(-HOUR),
    });
    expect(badWindow.status).toBe(400);
    // 202 create
    const created = await inject("POST", "/v1/consent/requests", T1, {
      principalId: principal, requestingDept: "Revenue", providingDept: "Registrar", purposeKey: "assess",
      dataCategories: ["address"], validFrom: iso(-HOUR), validTo: iso(HOUR), frequency: "one-time",
    });
    expect(created.status).toBe(202);
    const id = created.body.data.id as string;
    await infraQueue.drain();
    // grant, then fetch over HTTP (needs a holding first)
    await inject("POST", "/v1/consent/holdings", T1, { principalId: principal, providingDept: "Registrar", category: "address", value: { line1: "http" } });
    await infraQueue.drain();
    expect((await inject("POST", `/v1/consent/${id}/grant`, T1, {})).status).toBe(202);
    await infraQueue.drain();
    const ok = await inject("POST", `/v1/consent/${id}/fetch`, T1, { purposeKey: "assess", categories: ["address"] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.records[0].value.line1).toBe("http");
    // second one-time fetch → 403
    const denied = await inject("POST", `/v1/consent/${id}/fetch`, T1, { purposeKey: "assess", categories: ["address"] });
    expect(denied.status).toBe(403);
    expect(denied.body.reason).toBe("EXPIRED");
    // detail + ledger
    expect((await inject("GET", `/v1/consent/${id}`, T1)).status).toBe(200);
    const ledger = await inject("GET", `/v1/consent/principals/${principal}/ledger`, T1);
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta.total).toBeGreaterThanOrEqual(3);
    // 404 unknown, 409 grant-after-decision
    expect((await inject("GET", `/v1/consent/${randomUUID()}`, T1)).status).toBe(404);
    expect((await inject("POST", `/v1/consent/${id}/grant`, T1, {})).status).toBe(409);
  });

  it("policy.evaluateFetch covers every deny reason", () => {
    const base = {
      id: "x", tenantId: T1, principalId: "p", requestingDept: "R", providingDept: "P",
      purposeKey: "assess", dataCategories: ["address"], validFrom: new Date(Date.now() - HOUR),
      validTo: new Date(Date.now() + HOUR), frequency: "recurring", status: "active", fetchCount: 0,
      reason: null, requestedAt: new Date(), decidedAt: null, decidedBy: null, revokedAt: null, revokedBy: null,
      createdAt: new Date(), updatedAt: new Date(), createdBy: "c",
    } as unknown as repo.ConsentArtefactRow;
    const now = new Date();
    const R = (o: Partial<repo.ConsentArtefactRow>, cats = ["address"], purpose = "assess") =>
      evaluateFetch({ ...base, ...o } as repo.ConsentArtefactRow, { purposeKey: purpose, categories: cats }, now);
    expect(R({ status: "revoked" })).toEqual({ allowed: false, reason: "REVOKED" });
    expect(R({ status: "denied" })).toEqual({ allowed: false, reason: "DENIED" });
    expect(R({ status: "expired" })).toEqual({ allowed: false, reason: "EXPIRED" });
    expect(R({ status: "requested" })).toEqual({ allowed: false, reason: "NOT_GRANTED" });
    expect(R({ status: "granted" })).toEqual({ allowed: false, reason: "NOT_GRANTED" });
    expect(R({ status: "weird" as never })).toEqual({ allowed: false, reason: "NOT_ACTIVE" });
    expect(R({ validFrom: new Date(Date.now() + HOUR) })).toEqual({ allowed: false, reason: "WINDOW_NOT_STARTED" });
    expect(R({ validTo: new Date(Date.now() - HOUR) })).toEqual({ allowed: false, reason: "WINDOW_EXPIRED" });
    expect(R({}, ["address"], "other")).toEqual({ allowed: false, reason: "PURPOSE_MISMATCH" });
    expect(R({}, ["income"])).toEqual({ allowed: false, reason: "CATEGORY_OUT_OF_SCOPE" });
    expect(R({}, [])).toEqual({ allowed: false, reason: "CATEGORY_OUT_OF_SCOPE" });
    expect(R({ frequency: "one-time", fetchCount: 1 })).toEqual({ allowed: false, reason: "ALREADY_FETCHED" });
    expect(R({})).toEqual({ allowed: true });
  });
});
