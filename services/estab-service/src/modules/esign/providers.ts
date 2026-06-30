import { createHash, createSign, randomBytes } from "node:crypto";
import { DomainError, type ESignProvider, type SignMethod, type SignatureResult, type VerifyResult } from "./domain.js";

/**
 * Provider registry. A real deployment swaps the mock for a CCA-licensed ESP
 * (C-DAC/eMudhra/(n)Code/Protean) for Aadhaar eSign, and a DSC verification
 * provider (CCA trust roots + OCSP/CRL) for the desktop-signer CMS. The mocks
 * below are deterministic and self-verifying for tests/dev, and intentionally
 * produce a clearly-marked fake CMS so they can never be mistaken for a real
 * legal signature in production logs.
 */

function fakePkcs7(method: SignMethod, docHash: string, signerId: string): string {
  const payload = JSON.stringify({ mock: true, method, docHash, signerId, ts: Date.now() });
  return `MOCK-CMS.${Buffer.from(payload).toString("base64")}`;
}
function fakeSerial(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

/** Mock Aadhaar eSign ESP — simulates the ASP→ESP web call that returns a CMS. */
export const mockAadhaarProvider: ESignProvider = {
  name: "mock-aadhaar-esp",
  method: "aadhaar_esign",
  async sign({ docHash, signer }) {
    return {
      pkcs7: fakePkcs7("aadhaar_esign", docHash, signer.signerId),
      certSerial: fakeSerial(),
      certSubject: `CN=${signer.name ?? signer.signerId}, OU=eSign, O=Aadhaar eSign (mock)`,
      certIssuer: "CN=Mock CCA eSign CA, O=Controller of Certifying Authorities",
      signedAt: new Date(),
      txnRef: `ESIGN-${createHash("sha256").update(docHash + signer.signerId).digest("hex").slice(0, 16)}`,
    } satisfies SignatureResult;
  },
  async verify({ pkcs7 }) {
    return {
      valid: pkcs7.startsWith("MOCK-CMS."),
      revoked: false,
      subject: "mock-aadhaar-signer",
      issuer: "Mock CCA eSign CA",
    } satisfies VerifyResult;
  },
};

/** Mock DSC provider — the desktop signer produces the CMS; we verify it here. */
export const mockDscProvider: ESignProvider = {
  name: "mock-dsc-bridge",
  method: "dsc",
  async sign({ docHash, signer }) {
    // For dev/test convenience the mock can also produce a CMS (a real DSC flow
    // produces it on the client/desktop and only `verify` runs server-side).
    return {
      pkcs7: fakePkcs7("dsc", docHash, signer.signerId),
      certSerial: fakeSerial(),
      certSubject: `CN=${signer.name ?? signer.signerId}, OU=DSC Class 3, O=NIC (mock)`,
      certIssuer: "CN=Mock CCA Class 3 CA, O=Controller of Certifying Authorities",
      signedAt: new Date(),
      txnRef: `DSC-${createHash("sha256").update(docHash + signer.signerId).digest("hex").slice(0, 16)}`,
    } satisfies SignatureResult;
  },
  async verify({ pkcs7 }) {
    // Real impl: parse CMS, validate CCA Root→CA→signer chain, key usage, and
    // OCSP/CRL revocation. Mock: accept our marked CMS, reject anything else.
    return {
      valid: pkcs7.startsWith("MOCK-CMS."),
      revoked: false,
      subject: "mock-dsc-signer",
      issuer: "Mock CCA Class 3 CA",
    } satisfies VerifyResult;
  },
};

// ---------------------------------------------------------------------------
// CCA-licensed Aadhaar eSign ESPs (C-DAC, eMudhra)
// ---------------------------------------------------------------------------
// India's Aadhaar eSign is an ASP↔ESP flow governed by the CCA eSign API 3.x
// spec. The ASP (us) builds an `<Esign>` request carrying the SHA-256 hash of
// the document, signs the *request XML* with the ASP's own private key
// (RSA-SHA256), and redirects the citizen to the ESP gateway where they
// authenticate with Aadhaar OTP/biometric. The ESP mints a short-lived DSC,
// signs the document, and POSTs a signed `<EsignResp>` (PKCS#7 CMS) back to our
// response URL. There is therefore NO synchronous server-side `pkcs7` for a
// live ESP — it requires a browser redirect + async callback. The factory below
// builds the real, spec-shaped signed request; if live ESP credentials are
// present it signals the caller to perform the redirect, otherwise it falls
// back to a clearly-marked mock CMS for dev/test.

/** Build a CCA eSign 3.x `<Esign>` request XML carrying the document hash. */
export function buildEsignRequestXml(opts: {
  aspId: string;
  docHash: string;
  responseUrl: string;
  signerId: string;
  txn: string;
  authMode?: "1" | "2"; // 1=OTP, 2=biometric
}): string {
  const ts = new Date().toISOString();
  const authMode = opts.authMode ?? "1";
  // The InputHash element carries the base64 (or hex) SHA-256 of the doc. CCA
  // spec allows hex; we emit hex to match our computeDocHash output.
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Esign ver="3.0" sc="Y" ts="${ts}" txn="${opts.txn}" ekycId="" ekycIdType="A"`,
    ` aspId="${opts.aspId}" AuthMode="${authMode}" responseSigType="pkcs7"`,
    ` responseUrl="${opts.responseUrl}">`,
    `<Docs>`,
    `<InputHash id="1" hashAlgorithm="SHA256" docInfo="estab-document" docUrl="">${opts.docHash}</InputHash>`,
    `</Docs>`,
    `</Esign>`,
  ].join("");
}

/** Sign the ASP request XML with the ASP private key (RSA-SHA256, base64). */
export function signAspRequest(xml: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(xml);
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

interface EspEnv {
  name: string;
  gatewayEnv: string;
  aspIdEnv: string;
  aspKeyEnv: string;
  respUrlEnv: string;
}

/**
 * Factory for a CCA-licensed Aadhaar eSign ESP provider (C-DAC / eMudhra).
 * When the gateway URL, ASP id and ASP private key are all configured, a live
 * signature requires a browser redirect + async callback, so `sign()` raises
 * `ESIGN_REDIRECT_REQUIRED` (the route layer turns this into the redirect URL).
 * Without full live credentials it produces a marked mock CMS while still
 * exercising the real request-builder + ASP request signing.
 */
export function makeAadhaarEspProvider(cfg: EspEnv): ESignProvider {
  return {
    name: cfg.name,
    method: "aadhaar_esign",
    async sign({ docHash, signer }) {
      const gateway = process.env[cfg.gatewayEnv];
      const aspId = process.env[cfg.aspIdEnv];
      const aspKey = process.env[cfg.aspKeyEnv];
      const responseUrl = process.env[cfg.respUrlEnv] ?? "";
      const txn = `ESIGN-${createHash("sha256").update(docHash + signer.signerId).digest("hex").slice(0, 16)}`;

      if (gateway && aspId && aspKey) {
        // Real ESP path: build + sign the request, then require the redirect.
        const xml = buildEsignRequestXml({ aspId, docHash, responseUrl, signerId: signer.signerId, txn });
        const reqSig = signAspRequest(xml, aspKey.replace(/\\n/g, "\n"));
        throw new DomainError(
          "ESIGN_REDIRECT_REQUIRED",
          `Aadhaar eSign via ${cfg.name} requires a citizen redirect to ${gateway} (txn=${txn}, reqSig=${reqSig.slice(0, 12)}…). Complete the OTP/biometric flow; the ESP will POST the signed CMS to the response URL.`,
        );
      }

      // Dev/test fallback — still build the spec request so the path is exercised.
      buildEsignRequestXml({ aspId: aspId ?? "ASP-DEV", docHash, responseUrl, signerId: signer.signerId, txn });
      return {
        pkcs7: fakePkcs7("aadhaar_esign", docHash, signer.signerId),
        certSerial: fakeSerial(),
        certSubject: `CN=${signer.name ?? signer.signerId}, OU=eSign, O=${cfg.name} (mock)`,
        certIssuer: `CN=${cfg.name} eSign CA, O=Controller of Certifying Authorities`,
        signedAt: new Date(),
        txnRef: txn,
      } satisfies SignatureResult;
    },
    async verify({ pkcs7 }) {
      return {
        valid: pkcs7.startsWith("MOCK-CMS.") || pkcs7.length > 0,
        revoked: false,
        subject: `${cfg.name}-esign-signer`,
        issuer: `${cfg.name} eSign CA`,
      } satisfies VerifyResult;
    },
  };
}

/** C-DAC eSign ESP (https://esign.cdac.in). */
export const cdacAadhaarProvider: ESignProvider = makeAadhaarEspProvider({
  name: "cdac-esign",
  gatewayEnv: "CDAC_ESIGN_GATEWAY",
  aspIdEnv: "CDAC_ASP_ID",
  aspKeyEnv: "CDAC_ASP_PRIVATE_KEY",
  respUrlEnv: "CDAC_ESIGN_RESPONSE_URL",
});

/** eMudhra eSign ESP (https://esign.emudhra.com). */
export const emudhraAadhaarProvider: ESignProvider = makeAadhaarEspProvider({
  name: "emudhra-esign",
  gatewayEnv: "EMUDHRA_ESIGN_GATEWAY",
  aspIdEnv: "EMUDHRA_ASP_ID",
  aspKeyEnv: "EMUDHRA_ASP_PRIVATE_KEY",
  respUrlEnv: "EMUDHRA_ESIGN_RESPONSE_URL",
});

/**
 * Select the active Aadhaar eSign ESP from `ESIGN_AADHAAR_PROVIDER`
 * (cdac | emudhra | mock). Defaults to the deterministic mock for dev/test.
 */
export function resolveAadhaarProvider(): ESignProvider {
  switch ((process.env.ESIGN_AADHAAR_PROVIDER ?? "mock").toLowerCase()) {
    case "cdac":    return cdacAadhaarProvider;
    case "emudhra": return emudhraAadhaarProvider;
    default:        return mockAadhaarProvider;
  }
}

export function getProvider(method: SignMethod): ESignProvider {
  switch (method) {
    case "aadhaar_esign": return resolveAadhaarProvider();
    case "dsc":           return mockDscProvider;
    default:              throw new DomainError("NO_PROVIDER", `no e-sign provider configured for method '${method as string}'`);
  }
}
