import { randomBytes } from "node:crypto";

export const PERMIT_STATUSES = ["issued", "active", "extended", "completed", "cancelled"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export function canExtend(status: string): boolean {
  return status === "issued" || status === "active" || status === "extended";
}

export function canComplete(status: string): boolean {
  return status === "issued" || status === "active" || status === "extended";
}

export function canCancel(status: string): boolean {
  return status === "issued" || status === "active";
}

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `RCP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

// Permit verification codes are the public-facing proof of authenticity for
// a road-cut permit (e.g. scanned/typed in by a field inspector). They MUST
// come from a CSPRNG with enough entropy to make guessing/enumeration
// infeasible. Math.random() (the prior implementation) is not
// cryptographically secure and must never back a security-relevant token —
// V8's generator is a predictable, non-cryptographic PRNG.
// 8 random bytes -> 16 hex chars -> 64 bits of entropy, well under the
// varchar(64) column limit, using an unambiguous alphabet (0-9, a-f) for
// manual transcription.
export function generateVerificationCode(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}
