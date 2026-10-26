/**
 * OWNER DECISION #19 (TENANT-CONSENT-EXCHANGE-01): only the consent_officer (DPO)
 * may approve / reject a consent request ON BEHALF of the data principal, with a
 * mandatory reason; tenant_admin is view-only. The principal may still decide
 * their own consent. Real DB + real consumers.
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
import { consentArtefacts, consentLedger } from "../src/modules/consent-exchange/schema.js";
import { registerConsentExchangeConsumers } from "../src/modules/consent-exchange/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-0000000019a0";
const MAKER = "cccccccc-3333-4000-8000-0000000019a1";   // raises the request
const DPO = "cccccccc-3333-4000-8000-0000000019a2";     // a different consent officer
const HOUR = 3600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: T, roles, sid: "s1" }, SECRET);

async function call(m: string, u: string, sub: string, roles: string[], p?: unknown): Promise<{ status: number; body: any }> {
  const app = await buildApp();
  const r = await app.inject({ method: m as "GET", url: u, headers: { authorization: `Bearer ${tok(sub, roles)}` }, ...(p !== undefined ? { payload: p as object } : {}) });
  await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

async function newRequest(principalId: string): Promise<string> {
  const r = await call("POST", "/v1/consent/requests", MAKER, ["dept_officer", "consent_officer"], {
    principalId, requestingDept: "Revenue", providingDept: "Registrar", purposeKey: "assess",
    dataCategories: ["address"], validFrom: iso(-HOUR), validTo: iso(HOUR),
  });
  expect(r.status).toBe(202);
  await infraQueue.drain();
  return r.body.data.id as string;
}

const status = async (id: string) => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(consentArtefacts).where(eq(consentArtefacts.id, id)))))[0]?.status;

describe("consent decisions on behalf (owner decision #19)", () => {
  beforeAll(async () => { registerConsentExchangeConsumers(infraQueue); await infraQueue.start(); });
  afterAll(async () => {
    await runWithTenant(T, () => db.transaction((tx) => tx.delete(consentArtefacts).where(eq(consentArtefacts.tenantId, T))));
    await sqlClient.end();
  });

  it("tenant_admin / platform_admin / super_admin / grievance_officer cannot approve or reject on behalf", async () => {
    const principal = randomUUID();
    const id = await newRequest(principal);
    for (const roles of [["tenant_admin"], ["platform_admin"], ["super_admin"], ["grievance_officer"]]) {
      expect((await call("POST", `/v1/consent/${id}/grant`, DPO, roles, { reason: "attempt" })).status).toBe(403);
      expect((await call("POST", `/v1/consent/${id}/deny`, DPO, roles, { reason: "attempt" })).status).toBe(403);
    }
    expect(await status(id)).toBe("requested");
  });

  it("tenant_admin keeps read access (view-only)", async () => {
    const r = await call("GET", "/v1/tenant/consent/requests", DPO, ["tenant_admin"]);
    expect(r.status).toBe(200);
  });

  it("consent_officer must give a reason to decide on behalf (400 REASON_REQUIRED)", async () => {
    const id = await newRequest(randomUUID());
    const none = await call("POST", `/v1/consent/${id}/deny`, DPO, ["consent_officer"], {});
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("REASON_REQUIRED");
    const blank = await call("POST", `/v1/consent/${id}/grant`, DPO, ["consent_officer"], { reason: "  " });
    expect(blank.status).toBe(400);
    expect(await status(id)).toBe("requested");
  });

  it("consent_officer with a reason approves; the reason lands in the ledger", async () => {
    const principal = randomUUID();
    const id = await newRequest(principal);
    const r = await call("POST", `/v1/consent/${id}/grant`, DPO, ["consent_officer"], { reason: "Citizen consented in person, form F-12 on file" });
    expect(r.status).toBe(202);
    await infraQueue.drain();
    expect(await status(id)).toBe("active");
    const led = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(consentLedger).where(eq(consentLedger.artefactId, id))));
    expect(led.find((l) => l.eventType === "grant")?.reason).toBe("Citizen consented in person, form F-12 on file");
  });

  it("an officer cannot decide a request they raised themselves (SELF_APPROVAL)", async () => {
    const id = await newRequest(randomUUID());
    const r = await call("POST", `/v1/consent/${id}/grant`, MAKER, ["consent_officer"], { reason: "I raised it, I approve it" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("SELF_APPROVAL");
    expect(await status(id)).toBe("requested");
  });

  it("consumer re-enforces segregation of duties and the reason (direct command)", async () => {
    const id = await newRequest(randomUUID());
    const mq = new MemoryQueue(); registerConsentExchangeConsumers(mq);
    const send = async (actorId: string, payload: Record<string, unknown>) => {
      await mq.publish("tenant.consent.grant", { messageId: randomUUID(), type: "tenant.consent.grant", tenantId: T, actorId, correlationId: "c", schemaVersion: "1.0", payload: { id, tenantId: T, ...payload } });
      await mq.drain();
    };
    await send(MAKER, { reason: "self approval" });
    expect(await status(id)).toBe("requested");
    await send(DPO, {});
    expect(await status(id)).toBe("requested");
    await send(DPO, { reason: "valid reason from a different officer" });
    expect(await status(id)).toBe("active");
  });

  it("the data principal still decides their own consent without an officer role", async () => {
    const principal = randomUUID();
    const id = await newRequest(principal);
    const r = await call("POST", `/v1/consent/${id}/deny`, principal, ["data_principal"], {});
    expect(r.status).toBe(202);
    await infraQueue.drain();
    expect(await status(id)).toBe("denied");
  });
});
