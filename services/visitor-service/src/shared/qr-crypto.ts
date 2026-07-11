// shared/qr-crypto.ts
//
// RS256-signed JWT generation/verification for Digital_Pass QR codes.
// Per-tenant RSA key pairs allow gate terminals to verify passes offline
// using only the tenant's public key (no DB lookup required for signature
// validation). See design.md "QR Code Generation (RS256-Signed JWT)".

import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";

const ISSUER = "civitasone:visitor-service";

export interface PassQrPayload {
  visit_id: string;
  visitor_id: string;
  tenant_id: string;
  location_id: string;
  valid_from: number; // Unix epoch seconds
  valid_until: number; // Unix epoch seconds
  permitted_areas: string[]; // area UUIDs
  pass_type: "single" | "multi_day" | "recurring" | "event";
  pass_number: string; // Human-readable fallback
}

/**
 * Signs a Pass_QR payload as a compact RS256 JWT using the tenant's
 * PKCS8-encoded private key. The `kid` header is set to `tenant_id` so
 * multi-tenant verification can select the correct public key.
 */
export async function signPassQr(
  payload: PassQrPayload,
  tenantPrivateKeyPem: string,
): Promise<string> {
  const privateKey = await importPKCS8(tenantPrivateKeyPem, "RS256");
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: payload.tenant_id })
    .setIssuedAt()
    .setNotBefore(payload.valid_from)
    .setExpirationTime(payload.valid_until)
    .setIssuer(ISSUER)
    .setSubject(payload.visitor_id)
    .sign(privateKey);
}

/**
 * Verifies a Pass_QR JWT's RS256 signature and standard claims (exp, nbf,
 * iss) using the tenant's SPKI-encoded public key, returning the decoded
 * payload. Throws (via `jose`'s `JWTVerifyResult`/error types) if the
 * signature is invalid or claims fail validation.
 */
export async function verifyPassQr(
  jwt: string,
  tenantPublicKeyPem: string,
): Promise<PassQrPayload> {
  const publicKey = await importSPKI(tenantPublicKeyPem, "RS256");
  const { payload } = await jwtVerify<PassQrPayload>(jwt, publicKey, {
    issuer: ISSUER,
  });
  return payload;
}
