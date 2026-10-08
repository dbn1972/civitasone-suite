import { describe, it, expect } from "vitest";
import { isDigiLockerConfigured, digiLockerFetch, defaultDigiLockerProvider } from "./domain.js";
import { digilockerFetchBody } from "./validators.js";
import { newPkceMaterial, codeChallengeS256, generateCodeVerifier } from "./oauth.js";
import { loadTrustStore, verifyPkcs7Document, configuredTrustStore } from "./verify.js";
import forge from "node-forge";

describe("GAP-CITIZEN-DOCUMENTS-02 — DigiLocker configured probe + consent", () => {
  it("isDigiLockerConfigured is false with no provider credentials (powers the probe route)", () => {
    expect(isDigiLockerConfigured({})).toBe(false);
    expect(isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "", DIGILOCKER_CLIENT_SECRET: "" })).toBe(false);
  });

  it("isDigiLockerConfigured is true only when both id and secret are present", () => {
    expect(
      isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "id", DIGILOCKER_CLIENT_SECRET: "secret" }),
    ).toBe(true);
    expect(isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "id" })).toBe(false);
  });

  it("digiLockerFetch never fabricates source-verified success when unconfigured", () => {
    const r = digiLockerFetch("digilocker://id_proof", {});
    expect(r.configured).toBe(false);
    expect(r.providerStatus).toBe("provider_unconfigured");
    expect(r.authenticity).toBe("unverified");
  });

  it("the digilocker-fetch body accepts an optional DPDP consent boolean (not stripped as unknown)", () => {
    const parsed = digilockerFetchBody.parse({
      serviceId: "11111111-1111-4111-8111-111111111111",
      docType: "id_proof",
      docUri: "digilocker://id_proof",
      consent: true,
    });
    expect(parsed.consent).toBe(true);
  });

  it("the consent flag remains optional for backward compatibility", () => {
    const parsed = digilockerFetchBody.parse({
      serviceId: "11111111-1111-4111-8111-111111111111",
      docType: "id_proof",
      docUri: "digilocker://id_proof",
    });
    expect(parsed.consent).toBeUndefined();
  });

  it("the default provider is fail-closed: unconfigured => no authorize URL, no fake success", () => {
    expect(defaultDigiLockerProvider.isConfigured()).toBe(false);
    expect(defaultDigiLockerProvider.authorizeUrl({ docType: "id_proof", redirectUri: "https://app/cb", state: "s" })).toBeNull();
    const r = defaultDigiLockerProvider.fetchDocument("digilocker://id_proof");
    expect(r.configured).toBe(false);
    expect(r.authenticity).toBe("unverified");
  });

  it("the default provider exchangeCode is fail-closed when unconfigured (no fabricated docUri)", async () => {
    const ex = await defaultDigiLockerProvider.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://app/cb" });
    expect(ex.ok).toBe(false);
    expect(ex.docUri).toBeNull();
    expect(ex.providerStatus).toBe("provider_unconfigured");
    expect(ex.artefact).toBeUndefined();
  });

  it("PKCE: S256 challenge is a deterministic base64url hash of the verifier", () => {
    const v = generateCodeVerifier();
    // base64url: no +, /, or = padding
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallengeS256(v)).toBe(codeChallengeS256(v));
    expect(codeChallengeS256(v)).not.toBe(v);
    const m = newPkceMaterial();
    expect(m.codeChallenge).toBe(codeChallengeS256(m.codeVerifier));
    expect(m.state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("artefact verification is fail-closed when NO trust store is configured", () => {
    expect(configuredTrustStore({})).toBeNull();
    const res = verifyPkcs7Document(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), null);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("trust_store_unconfigured");
  });

  it("a configured trust store rejects a malformed artefact (never fakes verified)", () => {
    // A real (self-issued fixture) PEM so loadTrustStore returns a store, but a
    // garbage signature DER must still fail closed as malformed.
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 1000);
    cert.validity.notAfter = new Date(Date.now() + 1_000_000);
    const attrs = [{ name: "commonName", value: "Fixture DigiLocker CA" }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert);
    const store = loadTrustStore(pem);
    expect(store).not.toBeNull();
    const res = verifyPkcs7Document(new Uint8Array([1, 2, 3]), new Uint8Array([0, 0, 0]), store);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("malformed_artefact");
  });
});
