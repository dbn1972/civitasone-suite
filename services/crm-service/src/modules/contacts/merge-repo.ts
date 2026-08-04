/**
 * Merge reassignment helpers for leads (= contacts) and accounts (DQ-002).
 *
 * Children of the duplicate record are re-pointed at the primary so the merged
 * record retains all activities, ownership and history. The non-Drizzle-modeled
 * tables (next_actions, account_plans, qbr_schedules, tenders, onboarding_cases,
 * lead_transitions, lead_queues, captured_activities, contact_roles) are updated
 * with tenant-scoped raw SQL; RLS + the explicit tenant_id predicate keep every
 * write inside the caller's tenant.
 */
import { eq, and, sql, type SQL } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { accounts, type AccountRow } from "./schema.js";

/** Minimal transaction handle: everything here needs only `execute`. */
export interface ExecTx {
  execute: (query: SQL) => Promise<unknown>;
}

/** Tenant-scoped, active account row (for merge field-copy). */
export async function findActiveAccountRow(
  id: string,
  tenantId: string,
): Promise<AccountRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId), sql`${accounts.status} = 'active'`))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Re-point every child that references a contact/lead from `fromId` to `toId`.
 * A lead in this platform IS a contact row (lead_status on contacts), so the
 * children are the contact's activities, deals, next-actions, sentiment
 * readings, captured items, transitions, queue entries and deal roles.
 */
export async function reassignContactChildren(
  tx: ExecTx,
  fromId: string,
  toId: string,
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`UPDATE crm.activities SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.deals SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.interaction_sentiments SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.contact_roles SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.captured_activities SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.lead_transitions SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.lead_queues SET contact_id = ${toId} WHERE contact_id = ${fromId} AND tenant_id = ${tenantId}`);
  // next_actions is polymorphic (subject_type, subject_id); a lead's actions are
  // filed under 'lead' or 'contact'.
  await tx.execute(sql`UPDATE crm.next_actions SET subject_id = ${toId} WHERE subject_id = ${fromId} AND tenant_id = ${tenantId} AND subject_type IN ('lead', 'contact')`);
}

/**
 * Re-point every child that references an account from `fromId` to `toId`:
 * the account's contacts, strategic plans, QBRs, tenders and onboarding cases.
 * Deals and activities follow transitively via the reassigned contacts.
 */
export async function reassignAccountChildren(
  tx: ExecTx,
  fromId: string,
  toId: string,
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`UPDATE crm.contacts SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.account_plans SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.qbr_schedules SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.tenders SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.onboarding_cases SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
}

/** Soft-delete an account (status = inactive) inside the caller's tx. */
export async function softDeleteAccount(
  tx: ExecTx,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<void> {
  await tx.execute(
    sql`UPDATE crm.accounts SET status = 'inactive', updated_at = now(), updated_by = ${actorId}, version = version + 1 WHERE id = ${id} AND tenant_id = ${tenantId}`,
  );
}

/** Apply a field-merge patch onto an account inside the caller's tx. */
export async function mergeUpdateAccount(
  tx: ExecTx,
  id: string,
  tenantId: string,
  patch: { industry?: string; website?: string; parentId?: string; gstin?: string; pan?: string },
  actorId: string,
): Promise<void> {
  const sets: SQL[] = [];
  if (patch.industry !== undefined) sets.push(sql`industry = ${patch.industry}`);
  if (patch.website !== undefined) sets.push(sql`website = ${patch.website}`);
  if (patch.parentId !== undefined) sets.push(sql`parent_id = ${patch.parentId}`);
  if (patch.gstin !== undefined) sets.push(sql`gstin = ${patch.gstin}`);
  if (patch.pan !== undefined) sets.push(sql`pan = ${patch.pan}`);
  if (sets.length === 0) return;
  const assignments = sql.join(
    [...sets, sql`updated_at = now()`, sql`updated_by = ${actorId}`, sql`version = version + 1`],
    sql`, `,
  );
  await tx.execute(sql`UPDATE crm.accounts SET ${assignments} WHERE id = ${id} AND tenant_id = ${tenantId}`);
}
