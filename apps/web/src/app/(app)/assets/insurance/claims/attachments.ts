/**
 * GAP-ASSETS-INSURANCE-CLAIMS-06: pure helpers for a claim's supporting documents. A document is uploaded
 * straight to storage through the admin uploads presign flow (FileUpload); the claim then carries only the
 * returned key plus what the browser reported about the file.
 */
export type ClaimAttachment = { key: string; fileName: string; size: number; mimeType: string };

/** The service accepts at most this many documents per claim. */
export const MAX_CLAIM_ATTACHMENTS = 5;

/** File types the "attachment" upload category accepts (admin-service uploads). */
export const CLAIM_ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png";

/** Adds an uploaded document; ignores a duplicate key and anything past the cap. */
export function addAttachment(list: readonly ClaimAttachment[], next: ClaimAttachment): ClaimAttachment[] {
  if (list.some((a) => a.key === next.key) || list.length >= MAX_CLAIM_ATTACHMENTS) return [...list];
  return [...list, next];
}

export function removeAttachment(list: readonly ClaimAttachment[], key: string): ClaimAttachment[] {
  return list.filter((a) => a.key !== key);
}

/** "2.0 KB" / "1.5 MB" for display. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseAttachments(value: unknown): ClaimAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: ClaimAttachment[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.fileName !== "string") continue;
    out.push({
      key: o.key,
      fileName: o.fileName,
      size: typeof o.size === "number" && Number.isFinite(o.size) ? o.size : 0,
      mimeType: typeof o.mimeType === "string" ? o.mimeType : "",
    });
  }
  return out;
}
