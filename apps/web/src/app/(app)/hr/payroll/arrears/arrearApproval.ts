/**
 * GAP-PAYROLL-ARREARS-03: whether the signed-in user may be offered "Approve"
 * on a pending arrear. Mirrors the server rule (arrears-approval consumer):
 * when the tenant requires approval, the creator cannot decide their own
 * arrear. UX only -- the server is authoritative (403 SELF_APPROVAL_FORBIDDEN).
 */
export function canDecideArrear(args: { createdBy: string | null; actorId: string | null; approvalRequired: boolean }): boolean {
  if (!args.approvalRequired) return true;
  if (!args.actorId || !args.createdBy) return true; // identity unknown: let the server decide
  return args.createdBy !== args.actorId;
}
