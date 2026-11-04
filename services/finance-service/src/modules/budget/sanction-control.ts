/**
 * UAT T-EDGE TE-02 (HIGH): a sanction is an authority to spend WITHIN the head allocation for the year; it was never
 * checked (two Rs 1 lakh sanctions approved in parallel on a Rs 1.5 lakh allocation both succeeded, and one
 * over-allocation sanction passed too). On create AND approve:
 *   available = allocation - (approved sanctions still outstanding + committed + expended)
 * for the head and financial year, where
 *  - allocation = budget.finance_budget_allocation.allocated_minor (re-appropriation moves it, so it is respected);
 *    with no allocation row, the budget head final grant (finance_budgets.re_minor, which re-appropriation and
 *    supplementary grants move) is the ceiling;
 *  - outstanding approved sanctions = sum(amount - utilised) of the OTHER approved sanctions of the head raised in the FY
 *    (the drawn part is already in committed / expended, so nothing is counted twice);
 *  - committed / expended = the books-based allocation line (monitoring-books.ts, the b15 expended-from-ledger rule);
 *    on the budget fallback expended = utilised_minor.
 * The check runs under a FOR UPDATE lock on the allocation (or budget) row, so parallel approvals on one head
 * serialise: exactly one wins, the other is refused BUDGET_EXCEEDED with the amount still available.
 */
import { sql } from "drizzle-orm";
import { enqueue } from "../../shared/outbox.js";
import { outstandingSanctionsTx } from "./sanction-outstanding.js";
import { DomainError } from "./domain.js";
import { NO_BUDGET_PROVISION } from "./provision.js";
import * as allocRepo from "./allocation-repo.js";
import * as repo from "./repo.js";
import { bookedLines, lineFor } from "./monitoring-books.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];

export type SanctionPreRead = { committedMinor: bigint; expendedMinor: bigint };

/** Books-based committed / expended for the head and FY (read before the locking transaction; see the file doc). */
export async function sanctionPreRead(tenantId: string, headId: string, fy: string): Promise<SanctionPreRead> {
  const alloc = await allocRepo.findAllocation(tenantId, headId, fy);
  if (alloc) {
    const line = lineFor(alloc, await bookedLines(tenantId, [alloc]));
    return { committedMinor: line.committedMinor, expendedMinor: line.actualMinor };
  }
  const budget = await repo.findBudget(headId, fy, tenantId);
  return { committedMinor: 0n, expendedMinor: budget?.utilisedMinor ?? 0n };
}

/** sanctionPreRead for an existing sanction (by id), or null when it does not exist. */
export async function sanctionPreReadFor(tenantId: string, sanctionId: string, fy: string): Promise<SanctionPreRead | null> {
  const s = await repo.findSanctionByIdAndTenant(sanctionId, tenantId);
  return s ? sanctionPreRead(tenantId, s.headId, fy) : null;
}

/** BUDGET_EXCEEDED carrying the amount still available (paise), for the 422 body. */
export class SanctionBudgetExceeded extends DomainError {
  constructor(public readonly availableMinor: bigint, public readonly requestedMinor: bigint, headCode: string, fy: string) {
    super("BUDGET_EXCEEDED", `sanction of ${requestedMinor} paise exceeds the ${availableMinor > 0n ? availableMinor : 0n} paise still available on head ${headCode} for ${fy} (allocation less approved sanctions, commitments and expenditure)`);
  }
}

/** Pure: the available amount. */
export function sanctionAvailable(ceilingMinor: bigint, outstandingSanctionsMinor: bigint, pre: SanctionPreRead): bigint {
  return ceilingMinor - outstandingSanctionsMinor - pre.committedMinor - pre.expendedMinor;
}

/** In the caller transaction: lock the head allocation (or budget) row for the FY and refuse an over-allocation. */
export async function assertSanctionWithinAllocationTx(
  tx: Tx, tenantId: string, s: { id: string; headId: string; amountMinor: bigint }, fy: string, pre: SanctionPreRead,
): Promise<{ availableMinor: bigint }> {
  let [ceil] = rowsOf(await tx.execute(sql`
    SELECT allocated_minor::text AS ceiling FROM budget.finance_budget_allocation
     WHERE tenant_id = ${tenantId}::uuid AND head_id = ${s.headId}::uuid AND fy = ${fy} FOR UPDATE
  `));
  if (!ceil) {
    [ceil] = rowsOf(await tx.execute(sql`
      SELECT re_minor::text AS ceiling FROM budget.finance_budgets
       WHERE tenant_id = ${tenantId}::uuid AND head_id = ${s.headId}::uuid AND fy = ${fy} FOR UPDATE
    `));
  }
  const [head] = rowsOf(await tx.execute(sql`SELECT code FROM budget.finance_heads WHERE id = ${s.headId}::uuid AND tenant_id = ${tenantId}::uuid`));
  const headCode = String(head?.code ?? s.headId);
  if (!ceil) throw new DomainError(NO_BUDGET_PROVISION, `no budget provision or allocation for head ${headCode} in financial year ${fy}: a sanction cannot be issued without one (GFR)`);
  const outstanding = await outstandingSanctionsTx(tx, tenantId, s.headId, fy, s.id);
  const available = sanctionAvailable(BigInt(String(ceil.ceiling)), outstanding, pre);
  if (s.amountMinor > available) throw new SanctionBudgetExceeded(available, s.amountMinor, headCode, fy);
  return { availableMinor: available };
}

/**
 * Approve a pending sanction in the caller transaction (shared by the synchronous route and the queue consumer):
 * allocation check under the row lock, then the conditional status flip, finance.sanction.approved and the audit.
 * Returns false when the sanction was no longer approvable (state changed / eOffice file in flight).
 */
export async function approveSanctionTx(
  tx: Tx, meta: { tenantId: string; actorId: string; correlationId: string },
  sanction: { id: string; headId: string; amountMinor: bigint }, fy: string, pre: SanctionPreRead, reason?: string,
): Promise<boolean> {
  const { availableMinor } = await assertSanctionWithinAllocationTx(tx, meta.tenantId, sanction, fy, pre);
  if (!(await repo.approveSanctionIfNoEfile(tx, sanction.id, meta.tenantId, meta.actorId))) return false;
  await enqueue(tx, {
    topic: "finance.sanction.approved", eventType: "finance.sanction.approved",
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: { sanctionId: sanction.id, headId: sanction.headId, amountMinor: sanction.amountMinor.toString() },
  });
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: {
      service: "finance", action: "approve", resourceType: "sanction", resourceId: sanction.id, outcome: "success",
      ...(reason ? { reason } : {}), fy, availableBeforeMinor: availableMinor.toString(), amountMinor: sanction.amountMinor.toString(),
    },
  });
  return true;
}
