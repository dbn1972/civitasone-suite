import { createHash, randomBytes } from "node:crypto";
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

const PROVIDERS: Record<SignMethod, ESignProvider> = {
  aadhaar_esign: mockAadhaarProvider,
  dsc: mockDscProvider,
};

export function getProvider(method: SignMethod): ESignProvider {
  const p = PROVIDERS[method];
  if (!p) throw new DomainError("NO_PROVIDER", `no e-sign provider configured for method '${method}'`);
  return p;
}
