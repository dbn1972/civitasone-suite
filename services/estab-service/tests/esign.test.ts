/**
 * H1 — legal e-signature: Aadhaar eSign (web gateway) + DSC (desktop signer →
 * web POST), pluggable per tenant with mode disabled|optional|mandatory.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { estabSignConfig, estabSignature } from "../src/modules/esign/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerEsignConsumers } from "../src/modules/esign/consumer.js";
import { registerDfaConsumers } from "../src/modules/dfa/consumer.js";
import { COMMANDS as ESIGN } from "../src/modules/esign/commands.js";
import { assertSigningAllowed, computeDocHash, DomainError } from "../src/modules/esign/domain.js";
import {
  mockAadhaarProvider, mockDscProvider,
  buildEsignRequestXml, resolveAadhaarProvider, cdacAadhaarProvider, emudhraAadhaarProvider,
} from "../src/modules/esign/providers.js";

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = "11111111-aaaa-4000-8000-0000000000e7";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000e7";
const ACTOR2 = "00000000-aaaa-4000-8000-0000000000e8";

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(estabSignature).where(eq(estabSignature.tenantId, TENANT));
      await tx.delete(estabSignConfig).where(eq(estabSignConfig.tenantId, TENANT));
      const { sql } = await import("drizzle-orm");
      await tx.execute(sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${TENANT}`);
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
      for (const m of MIDS) await tx.delete(processed).where(eq(processed.messageId, m));
    }),
  );
}
const MIDS: string[] = [];
const env = (type: string, payload: Record<string, unknown>, actor = ACTOR) => {
  const messageId = randomUUID(); MIDS.push(messageId);
  return { messageId, type, tenantId: TENANT, actorId: actor, correlationId: `c-${messageId.slice(0,8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(id: string, ms = 3000) {
  const dl = Date.now()+ms;
  while (Date.now()<dl) {
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, id))),
    );
    if (rows.length===1) return;
    await new Promise(r=>setTimeout(r,40));
  }
}
async function setConfig(mode: string, methods: string[]) {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(estabSignConfig).values({ tenantId: TENANT, mode, allowedMethods: methods, updatedBy: ACTOR })
        .onConflictDoUpdate({ target: estabSignConfig.tenantId, set: { mode, allowedMethods: methods } }),
    ),
  );
}
async function seedNote(fileId: string, noteId: string) {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({ id: fileId, tenantId: TENANT, fileNo: `F/${fileId.slice(0,8)}`, subject: "s", dept: "ESTAB", currentWith: ACTOR, status: "active", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(estabNotings).values({ id: noteId, tenantId: TENANT, fileId, seq: 1, officerId: ACTOR, body: "Approved for sanction.", noteType: "green", noteStatus: "submitted", eSigned: false, createdBy: ACTOR, updatedBy: ACTOR });
    }),
  );
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("eSign domain (pure)", () => {
  it("assertSigningAllowed rejects disabled and disallowed methods", () => {
    expect(() => assertSigningAllowed({ mode: "disabled", allowedMethods: ["dsc"] }, "dsc")).toThrowError(/SIGNING_DISABLED/);
    expect(() => assertSigningAllowed({ mode: "optional", allowedMethods: ["dsc"] }, "aadhaar_esign")).toThrowError(/METHOD_NOT_ALLOWED/);
    expect(() => assertSigningAllowed({ mode: "mandatory", allowedMethods: ["aadhaar_esign","dsc"] }, "aadhaar_esign")).not.toThrow();
  });
  it("mock providers sign + self-verify; verify rejects junk CMS", async () => {
    const h = computeDocHash("noting", randomUUID(), "body");
    const a = await mockAadhaarProvider.sign({ docHash: h, signer: { signerId: ACTOR } });
    expect(a.pkcs7).toMatch(/^MOCK-CMS\./);
    expect((await mockAadhaarProvider.verify({ docHash: h, pkcs7: a.pkcs7 })).valid).toBe(true);
    expect((await mockDscProvider.verify({ docHash: h, pkcs7: "not-a-cms" })).valid).toBe(false);
  });
});

describe("Aadhaar eSign ESP providers (C-DAC / eMudhra)", () => {
  const SAVED = process.env.ESIGN_AADHAAR_PROVIDER;
  afterAll(() => {
    if (SAVED === undefined) delete process.env.ESIGN_AADHAAR_PROVIDER;
    else process.env.ESIGN_AADHAAR_PROVIDER = SAVED;
    delete process.env.CDAC_ESIGN_GATEWAY;
    delete process.env.CDAC_ASP_ID;
    delete process.env.CDAC_ASP_PRIVATE_KEY;
  });

  it("buildEsignRequestXml emits CCA eSign 3.x request carrying the SHA-256 doc hash", () => {
    const docHash = computeDocHash("dfa", "11111111-aaaa-4000-8000-000000000aaa", "Order body");
    const xml = buildEsignRequestXml({ aspId: "ASP-CIV", docHash, responseUrl: "https://civ/esign/resp", signerId: ACTOR, txn: "ESIGN-deadbeef" });
    expect(xml).toContain(`<Esign ver="3.0"`);
    expect(xml).toContain(`aspId="ASP-CIV"`);
    expect(xml).toContain(`responseUrl="https://civ/esign/resp"`);
    expect(xml).toContain(`hashAlgorithm="SHA256"`);
    expect(xml).toContain(docHash);
    expect(xml).toContain(`txn="ESIGN-deadbeef"`);
  });

  it("resolveAadhaarProvider selects cdac/emudhra/mock by env (default mock)", () => {
    delete process.env.ESIGN_AADHAAR_PROVIDER;
    expect(resolveAadhaarProvider().name).toBe("mock-aadhaar-esp");
    process.env.ESIGN_AADHAAR_PROVIDER = "cdac";
    expect(resolveAadhaarProvider().name).toBe("cdac-esign");
    process.env.ESIGN_AADHAAR_PROVIDER = "emudhra";
    expect(resolveAadhaarProvider().name).toBe("emudhra-esign");
    process.env.ESIGN_AADHAAR_PROVIDER = "something-unknown";
    expect(resolveAadhaarProvider().name).toBe("mock-aadhaar-esp");
  });

  it("ESP providers carry correct method/name and mock-sign without live credentials", async () => {
    delete process.env.CDAC_ESIGN_GATEWAY;
    delete process.env.CDAC_ASP_ID;
    delete process.env.CDAC_ASP_PRIVATE_KEY;
    expect(cdacAadhaarProvider.method).toBe("aadhaar_esign");
    expect(emudhraAadhaarProvider.method).toBe("aadhaar_esign");
    const h = computeDocHash("noting", randomUUID(), "body");
    const r = await cdacAadhaarProvider.sign({ docHash: h, signer: { signerId: ACTOR } });
    expect(r.pkcs7).toMatch(/^MOCK-CMS\./);
    expect(r.certIssuer).toMatch(/cdac-esign eSign CA/);
  });

  it("live ESP credentials force a citizen redirect (ESIGN_REDIRECT_REQUIRED)", async () => {
    process.env.CDAC_ESIGN_GATEWAY = "https://esign.cdac.in/v3/esign";
    process.env.CDAC_ASP_ID = "ASP-CIV";
    // a throwaway RSA key generated at runtime so signAspRequest succeeds
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CDAC_ASP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const h = computeDocHash("dfa", randomUUID(), "body");
    await expect(cdacAadhaarProvider.sign({ docHash: h, signer: { signerId: ACTOR } }))
      .rejects.toThrowError(/ESIGN_REDIRECT_REQUIRED/);
  });
});

describe("eSign signing (DB)", () => {
  it("Aadhaar eSign (web) signs a noting and records a verifiable signature", async () => {
    const fileId = randomUUID(), noteId = randomUUID();
    await seedNote(fileId, noteId);
    await setConfig("optional", ["aadhaar_esign", "dsc"]);
    const q = wireTenantAwareQueue(new MemoryQueue()); registerEsignConsumers(q); await q.start();
    const m = env(ESIGN.esignSign, { id: randomUUID(), tenantId: TENANT, signerId: ACTOR, subjectType: "noting", subjectId: noteId, method: "aadhaar_esign" });
    await q.publish(ESIGN.esignSign, m); await waitProcessed(m.messageId); await q.stop();
    const sig = (await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabSignature).where(eq(estabSignature.subjectId, noteId))),
    ))[0];
    expect(sig?.method).toBe("aadhaar_esign");
    expect(sig?.valid).toBe(true);
    expect(sig?.pkcs7).toMatch(/^MOCK-CMS\./);
    expect(sig?.certIssuer).toMatch(/eSign CA/);
  });

  it("DSC (desktop) accepts a client-posted CMS after verification", async () => {
    const fileId = randomUUID(), noteId = randomUUID();
    await seedNote(fileId, noteId);
    await setConfig("optional", ["dsc"]);
    const docHash = computeDocHash("noting", noteId, "Approved for sanction.");
    const clientCms = (await mockDscProvider.sign({ docHash, signer: { signerId: ACTOR } })).pkcs7;
    const q = wireTenantAwareQueue(new MemoryQueue()); registerEsignConsumers(q); await q.start();
    const m = env(ESIGN.esignSign, { id: randomUUID(), tenantId: TENANT, signerId: ACTOR, subjectType: "noting", subjectId: noteId, method: "dsc", pkcs7: clientCms, certSubject: "CN=Officer", certIssuer: "CN=CA" });
    await q.publish(ESIGN.esignSign, m); await waitProcessed(m.messageId); await q.stop();
    const sig = (await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabSignature).where(eq(estabSignature.subjectId, noteId))),
    ))[0];
    expect(sig?.method).toBe("dsc");
    expect(sig?.valid).toBe(true);
  });

  it("rejects signing when disabled, and when method not allowed (no signature recorded)", async () => {
    const fileId = randomUUID(), noteId = randomUUID();
    await seedNote(fileId, noteId);
    await setConfig("optional", ["dsc"]); // aadhaar NOT allowed
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 })); registerEsignConsumers(q); await q.start();
    const m = env(ESIGN.esignSign, { id: randomUUID(), tenantId: TENANT, signerId: ACTOR, subjectType: "noting", subjectId: noteId, method: "aadhaar_esign" });
    await q.publish(ESIGN.esignSign, m);
    await waitFor(async () => q.dlq.length === 1); await q.stop();
    expect((await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabSignature).where(eq(estabSignature.subjectId, noteId))),
    ))).toHaveLength(0);
    expect(q.dlq[0]?.error).toMatch(/METHOD_NOT_ALLOWED/);
  });
});

describe("mandatory signing gate on DFA dispatch", () => {
  async function seedApprovedDfa(dfaId: string) {
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.insert(estabDfa).values({ id: dfaId, tenantId: TENANT, dfaNo: `DFA/${dfaId.slice(0,6)}`, communicationType: "letter", subject: "Order", body: "Body text", status: "signed", createdBy: ACTOR, updatedBy: ACTOR }),
      ),
    );
  }
  it("mandatory tenant: unsigned DFA cannot be dispatched, signed one can", async () => {
    await setConfig("mandatory", ["aadhaar_esign", "dsc"]);
    const dfaId = randomUUID();
    await seedApprovedDfa(dfaId);
    const q = wireTenantAwareQueue(new MemoryQueue()); registerDfaConsumers(q); registerEsignConsumers(q); await q.start();

    // unsigned dispatch attempt → blocked (stays approved)
    const mDisp1 = env("estab.dfa.dispatch", { id: dfaId, tenantId: TENANT, mode: "post", toAddress: "X" });
    await q.publish("estab.dfa.dispatch", mDisp1); await waitProcessed(mDisp1.messageId);
    expect((await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabDfa).where(eq(estabDfa.id, dfaId))),
    ))[0]?.status).toBe("signed");

    // sign the DFA, then dispatch → dispatched
    const mSign = env(ESIGN.esignSign, { id: randomUUID(), tenantId: TENANT, signerId: ACTOR, subjectType: "dfa", subjectId: dfaId, method: "aadhaar_esign" });
    await q.publish(ESIGN.esignSign, mSign); await waitProcessed(mSign.messageId);
    const mDisp2 = env("estab.dfa.dispatch", { id: dfaId, tenantId: TENANT, mode: "post", toAddress: "X" });
    await q.publish("estab.dfa.dispatch", mDisp2); await waitProcessed(mDisp2.messageId); await q.stop();
    expect((await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabDfa).where(eq(estabDfa.id, dfaId))),
    ))[0]?.status).toBe("dispatched");
  });
});

async function waitFor(fn: () => Promise<boolean>, ms = 3000) {
  const dl = Date.now()+ms;
  while (Date.now()<dl) { if (await fn()) return; await new Promise(r=>setTimeout(r,40)); }
}
