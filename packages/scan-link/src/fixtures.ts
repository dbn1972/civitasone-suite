/**
 * Canonical sample messages of the scan-link contract, per target. Both sides assert against these:
 * document-service checks what it PUBLISHES (request / unlink request) equals the fixture shape and that it reaches the
 * right state on every fixture RESULT; each target service checks that it consumes the fixture requests and publishes
 * results shaped like the fixture results. Builders accept overrides so ids / timestamps can differ per test.
 */
import {
  LINK_TARGETS, linkRequestSchema, linkResultSchema, unlinkRequestSchema, unlinkResultSchema,
  type LinkRequest, type LinkResult, type LinkTarget, type UnlinkRequest, type UnlinkResult,
} from "./index.js";

export const FIXTURE_IDS = {
  linkId: "aaaaaaaa-0000-4000-8000-000000000001",
  documentId: "dddddddd-0000-4000-8000-000000000001",
  batchId: "bbbbbbbb-0000-4000-8000-000000000001",
  requestedBy: "00000000-aaaa-4000-8000-000000000001",
  approvedBy: "00000000-aaaa-4000-8000-000000000002",
  targetId: "cccccccc-0000-4000-8000-000000000001",
  filedAt: "2026-10-04T10:00:00.000Z",
} as const;

const DOC_TYPE: Record<LinkTarget, string> = {
  hr_employee: "service_book", finance_payment: "bill_voucher", finance_voucher: "bill_voucher", finance_bill: "bill_voucher", eoffice_file: "office_order",
};

export function linkRequestFixture(target: LinkTarget, over: Partial<LinkRequest> = {}): LinkRequest {
  const finance = target.startsWith("finance_");
  return linkRequestSchema.parse({
    linkId: FIXTURE_IDS.linkId, target, targetId: FIXTURE_IDS.targetId,
    document: {
      documentId: FIXTURE_IDS.documentId, batchId: FIXTURE_IDS.batchId, fileName: "scan-0001.pdf", mimeType: "application/pdf",
      docType: DOC_TYPE[target], pageCount: 2, ocrConfidence: 0.91, piiFlags: ["aadhaar"], textPreviewMasked: "Sample masked text XXXX XXXX 1234", filedAt: FIXTURE_IDS.filedAt,
    },
    requestedBy: FIXTURE_IDS.requestedBy, approvedBy: FIXTURE_IDS.approvedBy,
    ...(finance ? { financeHint: { reference: "V-100", amountMinor: "150000" } } : {}),
    ...over,
  });
}

export function linkResultFixture(target: LinkTarget, status: LinkResult["status"], over: Partial<LinkResult> = {}): LinkResult {
  const reason = status === "linked" ? null : status === "rejected" ? "TARGET_NOT_FOUND" : "AMOUNT_MISMATCH";
  return linkResultSchema.parse({ linkId: FIXTURE_IDS.linkId, target, targetId: FIXTURE_IDS.targetId, documentId: FIXTURE_IDS.documentId, status, reason, ...over });
}

export function unlinkRequestFixture(target: LinkTarget, over: Partial<UnlinkRequest> = {}): UnlinkRequest {
  return unlinkRequestSchema.parse({
    linkId: FIXTURE_IDS.linkId, target, targetId: FIXTURE_IDS.targetId, documentId: FIXTURE_IDS.documentId,
    reason: "attached to the wrong record", requestedBy: FIXTURE_IDS.requestedBy, ...over,
  });
}

export function unlinkResultFixture(status: UnlinkResult["status"], over: Partial<UnlinkResult> = {}): UnlinkResult {
  return unlinkResultSchema.parse({ linkId: FIXTURE_IDS.linkId, documentId: FIXTURE_IDS.documentId, status, reason: status === "unlinked" ? null : "LINK_NOT_FOUND", ...over });
}

export interface TargetFixtures {
  request: LinkRequest;
  results: Record<LinkResult["status"], LinkResult>;
  unlinkRequest: UnlinkRequest;
  unlinkResults: Record<UnlinkResult["status"], UnlinkResult>;
}

/** Every fixture, grouped per target. A function (not a constant): this module and index.ts import each other, so nothing may run at load time. */
export function scanLinkFixtures(): Record<LinkTarget, TargetFixtures> {
  return Object.fromEntries(LINK_TARGETS.map((t) => [t, {
    request: linkRequestFixture(t),
    results: { linked: linkResultFixture(t, "linked"), rejected: linkResultFixture(t, "rejected"), flagged_mismatch: linkResultFixture(t, "flagged_mismatch") },
    unlinkRequest: unlinkRequestFixture(t),
    unlinkResults: { unlinked: unlinkResultFixture("unlinked"), rejected: unlinkResultFixture("rejected") },
  }])) as Record<LinkTarget, TargetFixtures>;
}
