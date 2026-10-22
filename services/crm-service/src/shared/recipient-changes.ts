/**
 * Which recipients of an escalation rule must be verified against the owning services
 * (policy-service roles, identity-service users) when the rule is saved.
 *
 * ONE rule for both escalation editors (lead rules in modules/assignment, task rules in
 * modules/activities), so they cannot drift apart again:
 *
 *  - a NEW rule (nothing stored yet) verifies every recipient it names;
 *  - an EXISTING rule verifies only a recipient that is being CHANGED, because the editors send
 *    the whole rule on every save. A rule whose manager has since left must still be tunable and,
 *    above all, DISABLEABLE: refusing to turn off a rule that points at nobody would leave an
 *    unusable rule switched on;
 *  - a rule being switched ON (disabled -> enabled) verifies every recipient it will have, changed
 *    or not: an enabled rule must escalate to someone who exists.
 *
 * Pure (no I/O) so the rule itself is unit-tested; the caller does the lookups it returns.
 */
export interface RuleRecipients {
  recipientRole?: string | null | undefined;
  recipientId?: string | null | undefined;
  enabled: boolean;
}

/** The recipients (role and/or user) to verify; an absent field needs no lookup. */
export interface RecipientsToVerify {
  recipientRole?: string;
  recipientId?: string;
}

const normalised = (v: string | null | undefined): string | null => (v ? v : null);

/**
 * @param current  the stored rule, or `undefined` for a rule that does not exist yet
 * @param next     the rule as it will be after this save (recipients and enabled flag, defaults applied)
 */
export function recipientsToVerify(current: RuleRecipients | undefined, next: RuleRecipients): RecipientsToVerify {
  const role = normalised(next.recipientRole);
  const user = normalised(next.recipientId);
  const enabling = current !== undefined && next.enabled && !current.enabled;
  const verifyAll = current === undefined || enabling;
  const out: RecipientsToVerify = {};
  if (role && (verifyAll || role !== normalised(current?.recipientRole))) out.recipientRole = role;
  if (user && (verifyAll || user !== normalised(current?.recipientId))) out.recipientId = user;
  return out;
}
