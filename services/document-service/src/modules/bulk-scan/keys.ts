/**
 * Tenant-scoped private object keys. All ids are validated as UUIDs so a key can never be steered
 * outside its tenant prefix. Derivative keys are deterministic per file id (idempotent re-runs).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(label: string, v: string): string {
  if (!UUID_RE.test(v)) throw new Error("invalid " + label + " for storage key");
  return v.toLowerCase();
}

export const keys = {
  original: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/original`,
  textMasked: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/derived/text.masked.txt`,
  structuredJson: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/derived/structured.json`,
  searchablePdf: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/derived/searchable.pdf`,
  /** Final reviewed masked text (only written when a reviewer edited the OCR text). */
  textFinal: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/derived/text.final.txt`,
  /** Review page image n (1-based). */
  pageImage: (tenantId: string, batchId: string, fileId: string, page: number): string => {
    if (!Number.isInteger(page) || page < 1 || page > 5000) throw new Error("invalid page for storage key");
    return `tenants/${uuid("tenantId", tenantId)}/bulk-scan/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}/derived/pages/${page}`;
  },
  quarantine: (tenantId: string, batchId: string, fileId: string): string =>
    `tenants/${uuid("tenantId", tenantId)}/bulk-scan-quarantine/${uuid("batchId", batchId)}/${uuid("fileId", fileId)}`,
} as const;

/** Reject any key not under the tenant's own bulk-scan prefixes. */
export function isTenantKey(tenantId: string, key: string): boolean {
  const t = uuid("tenantId", tenantId);
  return key.startsWith(`tenants/${t}/bulk-scan/`) || key.startsWith(`tenants/${t}/bulk-scan-quarantine/`);
}
