/** Test-only helpers for the Bulk scan component tests (not imported by production code). */
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

export function renderIntl(ui: ReactElement, locale: "en" | "hi" = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>);
}

export function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; }, headers: new Headers({ "content-type": "application/json" }) } as unknown as Response;
}

export const BATCH = {
  id: "b1", name: "March scans", status: "processing", targetFolderId: null, defaultTags: ["hr"], defaultDocType: null, linkTarget: null, profileId: null,
  fileCount: 6, totalBytes: 6_000_000, counts: { queued: 2, filed: 2, failed: 1, needs_review: 1 }, progress: { total: 6, settled: 4, percent: 67 },
  createdBy: "u1", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", completedAt: null, cancelledAt: null, version: 1,
};

export function file(id: string, state: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, batchId: "b1", originalName: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 1000, state, failureReason: null, failureDetail: null, deadLetter: false,
    attempts: 0, nextAttemptAt: null, scanStatus: null, pageCount: 2, ocrMeanConfidence: 0.9, docType: null, piiFlags: [], reviewReasons: [], duplicateOf: null,
    filedDocumentId: null, tags: [], updatedAt: "2026-10-01T10:00:00.000Z", version: 1, ...over,
  };
}
