/**
 * Which file classifications keep their subject and note text out of lists and queues.
 *
 * The File Register shows these subjects as "[Classified]" because clearance claims are not
 * available in the web session (GAP-ESTAB-LIST-01), and the approvals queue follows the same
 * rule (GAP-ESTAB-APPROVALS-03). Whoever may read such a file opens it, and the service decides.
 */
export const MASKED_CLASSIFICATIONS: ReadonlySet<string> = new Set(["secret", "top_secret"]);

/**
 * True when a file's subject and note text must not be shown in a list or queue. A missing or
 * non-text classification counts as masked: when the file cannot be classified, it is not exposed.
 */
export function isMaskedClassification(classification: unknown): boolean {
  return typeof classification !== "string" || MASKED_CLASSIFICATIONS.has(classification);
}
