/** Pure limit checks shared by the route (fast-fail at URL-issue time) and the consumer (atomic re-check). */
import type { BulkScanSettings } from "./validators.js";

export type LimitViolation =
  | { code: "FILE_TOO_LARGE"; fileIndex: number; limit: number }
  | { code: "TOO_MANY_FILES"; limit: number }
  | { code: "BATCH_TOO_LARGE"; limit: number };

export function checkUploadLimits(
  limits: BulkScanSettings["limits"],
  current: { fileCount: number; totalBytes: number },
  incoming: { sizeBytes: number }[],
): LimitViolation | null {
  const tooBig = incoming.findIndex((f) => f.sizeBytes > limits.maxFileBytes);
  if (tooBig >= 0) return { code: "FILE_TOO_LARGE", fileIndex: tooBig, limit: limits.maxFileBytes };
  if (current.fileCount + incoming.length > limits.maxFilesPerBatch) return { code: "TOO_MANY_FILES", limit: limits.maxFilesPerBatch };
  const bytes = incoming.reduce((a, f) => a + f.sizeBytes, 0);
  if (current.totalBytes + bytes > limits.maxBatchBytes) return { code: "BATCH_TOO_LARGE", limit: limits.maxBatchBytes };
  return null;
}
