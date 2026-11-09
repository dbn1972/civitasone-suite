/**
 * F102: refTypes whose downstream approve handler itself enforces
 * maker != checker against the actor workflow forwards (the instance
 * initiator is the record's maker):
 *  - procurement_indent / procurement_po / procurement_plan /
 *    procurement_po_amendment: procurement-service assertDistinctMakerChecker
 *  - payroll_run: payroll-service SELF_APPROVAL_FORBIDDEN on run approve
 *  - meeting_decision (B23b): the GFR financial counter-signature. No downstream handler enforces it, so
 *    workflow itself must: the person who recorded the decision (the instance initiator) can never
 *    counter-sign it, super_admin included.
 * For these the super_admin break-glass must NOT let the initiator complete
 * the task: workflow would consume the task and complete the instance, the
 * domain would then refuse the self-approval, and the record would be left
 * pending with no open task anywhere. The initiator is refused up front
 * (403 SOD_SELF_APPROVAL) and the consumer refuses it again under the lock.
 */
export const STRICT_SOD_REF_TYPES: ReadonlySet<string> = new Set([
  "procurement_indent",
  "procurement_po",
  "procurement_plan",
  "procurement_po_amendment",
  "payroll_run",
  "meeting_decision",
]);

export function isStrictSodRefType(refType: string | null | undefined): boolean {
  return refType != null && STRICT_SOD_REF_TYPES.has(refType);
}
