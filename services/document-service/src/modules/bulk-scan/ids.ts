import { stableUuid } from "../../shared/outbox.js";

/**
 * The document id a scanned file will have once filed. Deterministic per file id so that (a) filing is
 * idempotent under redelivery, (b) a link request can name the document BEFORE it is created (documents are
 * only created once the target service confirmed the link), and (c) read-audits can name the document of a
 * file that is still in review.
 */
export const documentIdFor = (fileId: string): string => stableUuid("bulk-scan-document:" + fileId);
