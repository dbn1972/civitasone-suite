/**
 * A document dependency is unavailable right now: the caller answers 503 with `code` and does NOT issue
 * the document (never a placeholder, never another tenant's identity). Subclasses: PdfRendererUnavailableError
 * (no Chromium), TenantIdentityUnavailableError (tenant-service could not be read).
 */
export class DocumentUnavailableError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DocumentUnavailableError";
  }
}
