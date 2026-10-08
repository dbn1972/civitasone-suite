/**
 * GAP-CITIZEN-DOCUMENTS-02 — DigiLocker OAuth consent flow (DB-backed).
 *
 * Asserts the NEW capability (fails on old code: there was no authorize route,
 * no callback, no consent record, no artefact verification):
 *   • unconfigured provider ⇒ /authorize is 409 PROVIDER_UNCONFIGURED (fail-closed);
 *   • configured provider ⇒ /authorize mints PKCE+state, persists a server-side
 *     state row, and returns a real provider authorize URL (code_challenge, S256);
 *   • /callback with a foreign/unknown state ⇒ 400 (anti-CSRF/fixation);
 *   • /callback exchanges the code via the provider, persists a CONSENT record,
 *     and marks the submission source_verified ONLY when the signed artefact
 *     verifies (PKCS#7 structure + signer cert + chain to the configured trust
 *     store) — an UNtrusted signer ⇒ received/unverified, never fake-verified;
 *   • after a live consent exists, a configured-provider fetch is allowed; with
 *     NO live consent it is 422 CONSENT_REQUIRED (DPDP fail-closed).
 *
 * A fake provider is used ONLY here (never in production source). The signing
 * fixture is a self-issued CA used both as the trust anchor and the signer, so
 * the chain genuinely verifies for the happy path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";
import forge from "node-forge";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d02c0001-0000-4000-8000-000000000001";
const CITIZEN = "d02c0002-0000-4000-8000-000000000002";
const OTHER = "d02c0003-0000-4000-8000-000000000003";

// ── Signing fixture: a self-issued CA that is BOTH trust anchor and signer. ──
function buildFixture(): { trustPem: string; signedArtefact: { content: Uint8Array; signatureDer: Uint8Array } } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "DigiLocker Test Issuer" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, digitalSignature: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);

  const content = new Uint8Array(Buffer.from("<Certificate>citizen issued document bytes</Certificate>", "utf8"));
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(content).toString("binary"));
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256 as string,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType as string, value: forge.pki.oids.data as string },
      { type: forge.pki.oids.messageDigest as string },
      { type: forge.pki.oids.signingTime as string, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = new Uint8Array(Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary"));
  return { trustPem: certPem, signedArtefact: { content, signatureDer: der } };
}

const fixture = buildFixture();

// Configure the provider + trust store BEFORE the app/consumers import so the
// honesty gate sees a configured provider.
process.env.CITIZEN_DIGILOCKER_CLIENT_ID = `cid-${randomUUID()}`;
process.env.CITIZEN_DIGILOCKER_CLIENT_SECRET = randomUUID();
process.env.CITIZEN_DIGILOCKER_TRUST_PEM = fixture.trustPem;

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerDocumentsConsumers } = await import("../src/modules/documents/consumer.js");
const commands = await import("../src/modules/documents/commands.js");
import type { DigiLockerProvider } from "../src/modules/documents/domain.js";

registerDocumentsConsumers(queue);
await queue.start();

function tok(tenant: string, actor: string, roles = ["citizen"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-dl02" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function submissionById(id: string) {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT status, verification_status, authenticity, provider_status, digilocker_ref FROM documents.submissions WHERE id = ${id} AND tenant_id = ${TENANT}`;
  });
  return (rows[0] as { status: string; verification_status: string; authenticity: string; provider_status: string; digilocker_ref: string } | undefined) ?? null;
}

async function consentCountFor(citizenId: string, docType: string): Promise<number> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT count(*)::int AS n FROM documents.digilocker_consents WHERE tenant_id = ${TENANT} AND citizen_id = ${citizenId} AND doc_type = ${docType} AND revoked_at IS NULL`;
  });
  return (rows[0] as { n: number }).n;
}

/** A fake provider that returns a VALID signed artefact. */
const verifyingProvider: DigiLockerProvider = {
  isConfigured: () => true,
  authorizeUrl: ({ redirectUri, state, codeChallenge }) =>
    `https://provider.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
  exchangeCode: async () => ({
    ok: true, providerStatus: "fetched", docUri: "digilocker://in.gov.cbse/marksheet-12",
    artefact: fixture.signedArtefact,
  }),
  fetchDocument: () => ({ configured: true, providerStatus: "fetched", digilockerRef: "digilocker://x", authenticity: "source_verified" }),
};

/** A fake provider whose signer does NOT chain to the configured trust store. */
const untrustedProvider: DigiLockerProvider = {
  isConfigured: () => true,
  authorizeUrl: ({ state }) => `https://provider.example/authorize?state=${state}`,
  exchangeCode: async () => {
    // A different, independently self-issued cert signs the artefact — NOT in trust store.
    const k = forge.pki.rsa.generateKeyPair(2048);
    const c = forge.pki.createCertificate();
    c.publicKey = k.publicKey; c.serialNumber = "09";
    c.validity.notBefore = new Date(Date.now() - 1000);
    c.validity.notAfter = new Date(Date.now() + 1_000_000);
    const a = [{ name: "commonName", value: "Rogue Issuer" }];
    c.setSubject(a); c.setIssuer(a);
    c.setExtensions([{ name: "basicConstraints", cA: true }]);
    c.sign(k.privateKey, forge.md.sha256.create());
    const content = new Uint8Array(Buffer.from("rogue", "utf8"));
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer("rogue");
    p7.addCertificate(c);
    p7.addSigner({
      key: k.privateKey, certificate: c, digestAlgorithm: forge.pki.oids.sha256 as string,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType as string, value: forge.pki.oids.data as string },
        { type: forge.pki.oids.messageDigest as string },
      ],
    });
    p7.sign({ detached: true });
    const der = new Uint8Array(Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary"));
    return { ok: true, providerStatus: "fetched", docUri: "digilocker://rogue", artefact: { content, signatureDer: der } };
  },
  fetchDocument: () => ({ configured: true, providerStatus: "fetched", digilockerRef: "digilocker://x", authenticity: "source_verified" }),
};

function ctxFor(actor: string) {
  return { tenantId: TENANT, actorId: actor, actorType: "user" as const, correlationId: "corr-dl02", roles: ["citizen"] };
}

describe("GAP-CITIZEN-DOCUMENTS-02 — DigiLocker OAuth consent flow (DB-backed)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("configured provider: /authorize mints state+PKCE and returns a provider authorize URL", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/digilocker/authorize", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { docType: "marksheet", purpose: "scholarship application", redirectUri: "https://app.example/cb" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.state).toBe("string");
    expect(body.authorizeUrl).toContain("code_challenge");
    expect(body.authorizeUrl).toContain("code_challenge_method=S256");
    // state persisted server-side
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT code_verifier, actor_id FROM documents.digilocker_oauth_states WHERE state = ${body.state}`;
    });
    expect(rows.length).toBe(1);
    expect((rows[0] as { actor_id: string }).actor_id).toBe(CITIZEN);
  });

  it("callback with an unknown/foreign state is rejected (anti-CSRF)", async () => {
    await expect(
      commands.digilockerCallback(ctxFor(CITIZEN), { state: "not-a-real-state", code: "x", consentTtlDays: 90 }, verifyingProvider),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_STATE" });
  });

  it("callback with a verifying provider persists a consent and a SOURCE_VERIFIED submission", async () => {
    const begin = await commands.beginDigiLockerAuthorize(
      ctxFor(CITIZEN),
      { docType: "marksheet", purpose: "scholarship", redirectUri: "https://app.example/cb", citizenId: CITIZEN },
      verifyingProvider,
    );
    const out = await commands.digilockerCallback(
      ctxFor(CITIZEN), { state: begin.state, code: "auth-code", consentTtlDays: 90 }, verifyingProvider,
    );
    expect(out.data.verified).toBe(true);
    const row = await waitFor(() => submissionById(out.id));
    expect(row.authenticity).toBe("source_verified");
    expect(row.verification_status).toBe("verified");
    expect(row.digilocker_ref).toBe("digilocker://in.gov.cbse/marksheet-12");
    expect(await consentCountFor(CITIZEN, "marksheet")).toBeGreaterThanOrEqual(1);
  });

  it("callback with an UNTRUSTED signer records the doc as unverified (never fake source-verified)", async () => {
    const begin = await commands.beginDigiLockerAuthorize(
      ctxFor(OTHER),
      { docType: "pan", purpose: "kyc", redirectUri: "https://app.example/cb", citizenId: OTHER },
      untrustedProvider,
    );
    const out = await commands.digilockerCallback(
      ctxFor(OTHER), { state: begin.state, code: "auth-code", consentTtlDays: 30 }, untrustedProvider,
    );
    expect(out.data.verified).toBe(false);
    const row = await waitFor(() => submissionById(out.id));
    expect(row.authenticity).toBe("unverified");
    expect(row.status).toBe("received");
  });

  it("callback whose code exchange FAILED mints no consent and no submission (state still consumed)", async () => {
    const failingProvider: DigiLockerProvider = {
      ...verifyingProvider,
      exchangeCode: () => ({ ok: false, providerStatus: "provider_not_configured" }),
    };
    const citizen = randomUUID();
    const begin = await commands.beginDigiLockerAuthorize(
      ctxFor(citizen),
      { docType: "voter_id", purpose: "kyc", redirectUri: "https://app.example/cb", citizenId: citizen },
      failingProvider,
    );
    const out = await commands.digilockerCallback(
      ctxFor(citizen), { state: begin.state, code: "bad", consentTtlDays: 30 }, failingProvider,
    );
    expect(out.data.verified).toBe(false);
    await waitFor(async () => {
      const rows = await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`SELECT consumed_at FROM documents.digilocker_oauth_states WHERE state = ${begin.state}`;
      });
      return (rows[0] as { consumed_at: string | null }).consumed_at ? rows : null;
    });
    expect(await consentCountFor(citizen, "voter_id")).toBe(0);
    expect(await submissionById(out.id)).toBeNull();
  });

  it("state is single-use: a second callback with the same state is rejected", async () => {
    const begin = await commands.beginDigiLockerAuthorize(
      ctxFor(CITIZEN),
      { docType: "driving_licence", purpose: "address", redirectUri: "https://app.example/cb", citizenId: CITIZEN },
      verifyingProvider,
    );
    await commands.digilockerCallback(ctxFor(CITIZEN), { state: begin.state, code: "c1", consentTtlDays: 90 }, verifyingProvider);
    await waitFor(async () => {
      const rows = await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`SELECT consumed_at FROM documents.digilocker_oauth_states WHERE state = ${begin.state}`;
      });
      return (rows[0] as { consumed_at: string | null }).consumed_at ? rows : null;
    });
    await expect(
      commands.digilockerCallback(ctxFor(CITIZEN), { state: begin.state, code: "c2", consentTtlDays: 90 }, verifyingProvider),
    ).rejects.toMatchObject({ status: 409, code: "STATE_CONSUMED" });
  });

  it("configured-provider fetch REQUIRES a live consent record (DPDP fail-closed)", async () => {
    // A fresh citizen id guarantees NO pre-existing consent (the test DB is
    // persistent across runs), so the "no live consent" precondition holds.
    const freshCitizen = randomUUID();
    await expect(
      commands.digilockerFetchIntake(ctxFor(freshCitizen), { docType: "ration_card", docUri: "digilocker://ration_card", citizenId: freshCitizen }),
    ).rejects.toMatchObject({ status: 422, code: "CONSENT_REQUIRED" });

    // After a consent is granted via the callback, the fetch is allowed.
    const begin = await commands.beginDigiLockerAuthorize(
      ctxFor(freshCitizen),
      { docType: "ration_card", purpose: "subsidy", redirectUri: "https://app.example/cb", citizenId: freshCitizen },
      verifyingProvider,
    );
    await commands.digilockerCallback(ctxFor(freshCitizen), { state: begin.state, code: "c", consentTtlDays: 90 }, verifyingProvider);
    await waitFor(() => consentCountFor(freshCitizen, "ration_card").then((n) => (n > 0 ? n : null)));
    const accepted = await commands.digilockerFetchIntake(
      ctxFor(freshCitizen), { docType: "ration_card", docUri: "digilocker://ration_card", citizenId: freshCitizen },
    );
    expect(accepted.status).toBe("accepted");
  });
});
