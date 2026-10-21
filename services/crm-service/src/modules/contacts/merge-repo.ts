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
import { scopedRead, type Db } from "../../shared/db.js";
import { accounts, type AccountRow } from "./schema.js";

type Writer = Pick<Db, "insert" | "update" | "select">;

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
 * Tx-scoped variant of findActiveAccountRow -- see findActiveRowTx in
 * repo.ts for the full rationale (section 1 of the production-readiness-
 * audit skill). Used by mergeAccounts (this file, below), which already
 * had the identical fix applied to mergeLeads findActiveRow a few lines up
 * -- this call site was missed in the first pass.
 */
export async function findActiveAccountRowTx(
  tx: Writer,
  id: string,
  tenantId: string,
): Promise<AccountRow | null> {
  const rows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId), sql`${accounts.status} = 'active'`))
    .limit(1);
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
 * True when `ancestorId` is `nodeId` itself or appears in its parent chain
 * (cycle-safe: the recursive CTE uses UNION so a legacy loop terminates).
 */
export async function isSelfOrAncestor(
  tx: ExecTx,
  ancestorId: string,
  nodeId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM crm.accounts WHERE id = ${nodeId} AND tenant_id = ${tenantId}
      UNION
      SELECT a.id, a.parent_id FROM crm.accounts a
        JOIN chain c ON a.id = c.parent_id
       WHERE a.tenant_id = ${tenantId}
    )
    SELECT 1 AS hit FROM chain WHERE id = ${ancestorId} LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * Re-point the duplicate's CHILD ACCOUNTS (accounts.parent_id = duplicate) at the
 * primary so the hierarchy does not keep pointing at the tombstoned duplicate.
 *
 * Cycle guard: if the primary itself sits inside the duplicate's subtree, the
 * duplicate's direct child on the path down to the primary must NOT become a
 * child of the primary (primary -> ... -> that child -> primary would loop). That
 * one node is lifted to the duplicate's own parent instead (null = top level);
 * every other child moves under the primary.
 */
export async function reassignChildAccounts(
  tx: ExecTx,
  fromId: string,
  toId: string,
  tenantId: string,
  actorId: string,
  fromParentId: string | null,
): Promise<void> {
  const path = (await tx.execute(sql`
    WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM crm.accounts WHERE id = ${toId} AND tenant_id = ${tenantId}
      UNION
      SELECT a.id, a.parent_id FROM crm.accounts a
        JOIN chain c ON a.id = c.parent_id
       WHERE a.tenant_id = ${tenantId}
    )
    SELECT id FROM chain WHERE parent_id = ${fromId} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  const liftId = path[0]?.id ?? null;
  if (liftId) {
    await tx.execute(
      sql`UPDATE crm.accounts SET parent_id = ${fromParentId}, updated_at = now(), updated_by = ${actorId}, version = version + 1 WHERE id = ${liftId} AND tenant_id = ${tenantId}`,
    );
  }
  await tx.execute(
    sql`UPDATE crm.accounts SET parent_id = ${toId}, updated_at = now(), updated_by = ${actorId}, version = version + 1 WHERE parent_id = ${fromId} AND tenant_id = ${tenantId} AND id <> ${toId}`,
  );
}

/**
 * Re-point crm.account_relationships edges (from/to the duplicate) at the primary.
 * An edge that would become a self-loop (duplicate <-> primary) or collide with an
 * edge the primary already has (same other end + type) is dropped rather than
 * moved: the table forbids self-loops and has a unique (from, to, type) edge.
 */
export async function reassignAccountRelationships(
  tx: ExecTx,
  fromId: string,
  toId: string,
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM crm.account_relationships
     WHERE tenant_id = ${tenantId}
       AND ((from_account_id = ${fromId} AND to_account_id = ${toId})
         OR (from_account_id = ${toId} AND to_account_id = ${fromId}))
  `);
  await tx.execute(sql`
    DELETE FROM crm.account_relationships r
     WHERE r.tenant_id = ${tenantId} AND r.from_account_id = ${fromId}
       AND EXISTS (SELECT 1 FROM crm.account_relationships p
                    WHERE p.tenant_id = ${tenantId} AND p.from_account_id = ${toId}
                      AND p.to_account_id = r.to_account_id AND p.rel_type = r.rel_type)
  `);
  await tx.execute(sql`UPDATE crm.account_relationships SET from_account_id = ${toId} WHERE from_account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`
    DELETE FROM crm.account_relationships r
     WHERE r.tenant_id = ${tenantId} AND r.to_account_id = ${fromId}
       AND EXISTS (SELECT 1 FROM crm.account_relationships p
                    WHERE p.tenant_id = ${tenantId} AND p.to_account_id = ${toId}
                      AND p.from_account_id = r.from_account_id AND p.rel_type = r.rel_type)
  `);
  await tx.execute(sql`UPDATE crm.account_relationships SET to_account_id = ${toId} WHERE to_account_id = ${fromId} AND tenant_id = ${tenantId}`);
}

/**
 * Re-point every child that references an account from `fromId` to `toId`:
 * the account's contacts, account-subject activities, strategic plans, QBRs,
 * tenders, onboarding cases, child accounts and typed account relationships.
 * Deals follow transitively via the reassigned contacts.
 *
 * `fromParentId` is the duplicate's own parent (used to lift the one child that
 * would otherwise create a hierarchy loop -- see reassignChildAccounts).
 */
export async function reassignAccountChildren(
  tx: ExecTx,
  fromId: string,
  toId: string,
  tenantId: string,
  actorId: string,
  fromParentId: string | null = null,
): Promise<void> {
  await tx.execute(sql`UPDATE crm.contacts SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.activities SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.account_plans SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.qbr_schedules SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.tenders SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await tx.execute(sql`UPDATE crm.onboarding_cases SET account_id = ${toId} WHERE account_id = ${fromId} AND tenant_id = ${tenantId}`);
  await reassignChildAccounts(tx, fromId, toId, tenantId, actorId, fromParentId);
  await reassignAccountRelationships(tx, fromId, toId, tenantId);
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
