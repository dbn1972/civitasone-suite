import * as repo from "./repo.js";
import { publicValidity } from "./domain.js";

export async function listCertificates(tenantId: string) {
  return repo.listCertificates(tenantId);
}

export async function getCertificate(tenantId: string, id: string) {
  const cert = await repo.findCertById(id, tenantId);
  if (!cert) return null;
  const events = await repo.listEvents(tenantId, id);
  return { ...cert, events };
}

/**
 * Public, QR-scannable verification by opaque token. Returns ONLY
 * non-sensitive attestation fields — never the full payload — plus a validity
 * verdict. Tenant-agnostic: the token itself is the capability.
 */
export async function verifyByToken(token: string): Promise<{
  found: boolean;
  validity?: "valid" | "expired" | "invalid";
  certNo?: string | null;
  certType?: string;
  status?: string;
  validFrom?: string | null;
  validTo?: string | null;
  payloadHash?: string | null;
  signature?: string | null;
  issuedAt?: string | null;
}> {
  const cert = await repo.findCertByToken(token);
  if (!cert) return { found: false };
  return {
    found: true,
    validity: publicValidity(cert.status, cert.validTo),
    certNo: cert.certNo,
    certType: cert.certType,
    status: cert.status,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
    payloadHash: cert.payloadHash,
    signature: cert.signature,
    issuedAt: cert.issuedAt ? new Date(cert.issuedAt).toISOString() : null,
  };
}
