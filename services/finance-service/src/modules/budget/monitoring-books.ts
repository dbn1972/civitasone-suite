/**
 * UAT P2 (A7, recon D20) — budget monitoring figures read from the books of account (owner decision).
 *
 *   expended   = net debits (debit - credit) booked in the GL to the head inside the FY
 *                (bills passed, direct journal vouchers, reversals -- everything the ledger holds);
 *   commitment = the allocation's committed amount (bills raised and not yet paid) LESS the bills whose GL posting
 *                is already booked, so a booked bill is counted once, as expended, and never also as committed;
 *   available  = allocated - commitment - expended.
 *
 * Matching a bill to its booking is exact: the bill's GL journal id is deterministicId(`bill:<billId>`)
 * (payments/consumer.ts billApprove -> gl/spine.ts enqueueSpineJournal) and its single debit is the bill's net on the
 * bill's head, dated the bill date -- the same head, amount and FY the commitment was registered against
 * (payments/consumer.ts billCreate). A passed bill whose journal has not posted (still in the outbox, or refused by
 * the GL) is NOT treated as booked, so it stays in commitment until the books have it.
 *
 * Read model only: the stored allocation columns and the allocation ceiling guard (committed + actual <= allocated,
 * maintained by the bill/payment consumers) are unchanged.
 */
import { fyDateBounds } from "../dashboard/queries.js";
import * as glRepo from "../gl/repo.js";
import { deterministicId } from "../gl/spine.js";
import { fyFromDate } from "../hoa/voucher.js";
import * as paymentsRepo from "../payments/repo.js";
import type { BudgetAllocationRow } from "./allocation-schema.js";

export type BookedLine = { allocatedMinor: bigint; committedMinor: bigint; actualMinor: bigint };

export type BookableBill = { id: string; headId: string; netMinor: bigint; billDate: string | null; createdAt: Date | string };

const billFy = (b: BookableBill): string => fyFromDate(b.billDate ?? new Date(b.createdAt).toISOString().slice(0, 10));

/**
 * Pure core: the books-based line for one allocation, given the ledger net for its head/FY and the unpaid passed
 * bills of that head/FY whose GL journal is posted.
 */
export function bookedLine(r: Pick<BudgetAllocationRow, "allocatedMinor" | "committedMinor">, ledgerNetMinor: bigint, bookedUnpaidBillsMinor: bigint): BookedLine {
  const committed = r.committedMinor - bookedUnpaidBillsMinor;
  return { allocatedMinor: r.allocatedMinor, committedMinor: committed > 0n ? committed : 0n, actualMinor: ledgerNetMinor };
}

/** Books-based lines for allocation rows, keyed by allocation id. */
export async function bookedLines(tenantId: string, rows: readonly BudgetAllocationRow[]): Promise<Map<string, BookedLine>> {
  const out = new Map<string, BookedLine>();
  if (rows.length === 0) return out;
  const headIds = [...new Set(rows.map((r) => r.headId))];
  const bills = (await paymentsRepo.listPassedUnpaidBillsForHeads(tenantId, headIds)) as BookableBill[];
  const journalOf = new Map(bills.map((b) => [deterministicId(`bill:${b.id}`), b]));
  const posted = await glRepo.findPostedJournalIds(tenantId, [...journalOf.keys()]);
  const bookedByHeadFy = new Map<string, bigint>();
  for (const [jid, b] of journalOf) {
    if (!posted.has(jid)) continue;
    const k = `${b.headId}|${billFy(b)}`;
    bookedByHeadFy.set(k, (bookedByHeadFy.get(k) ?? 0n) + BigInt(b.netMinor));
  }
  const ledgerByFy = new Map<string, Map<string, bigint>>();
  for (const fy of new Set(rows.map((r) => r.fy.trim()))) {
    const bounds = fyDateBounds(fy);
    ledgerByFy.set(fy, bounds ? await glRepo.sumLedgerNetByHead(tenantId, rows.filter((r) => r.fy.trim() === fy).map((r) => r.headId), bounds.start, bounds.end) : new Map());
  }
  for (const r of rows) {
    const fy = r.fy.trim();
    out.set(r.id, bookedLine(r, ledgerByFy.get(fy)?.get(r.headId) ?? 0n, bookedByHeadFy.get(`${r.headId}|${fy}`) ?? 0n));
  }
  return out;
}
