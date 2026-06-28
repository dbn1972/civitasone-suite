import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  assetAcquisitions, assetTransfers, assetDisposals, pendingDisposals,
  type AcquisitionInsert, type TransferInsert, type DisposalInsert,
  type PendingDisposalInsert, type PendingDisposalRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAcquisition(tx: Writer, row: AcquisitionInsert): Promise<void> {
  await tx.insert(assetAcquisitions).values(row);
}

export async function insertTransfer(tx: Writer, row: TransferInsert): Promise<void> {
  await tx.insert(assetTransfers).values(row);
}

export async function insertDisposal(tx: Writer, row: DisposalInsert): Promise<void> {
  await tx.insert(assetDisposals).values(row);
}

// --- pending (eOffice-gated) disposals -------------------------------------

export async function insertPendingDisposal(tx: Writer, row: PendingDisposalInsert): Promise<void> {
  await tx.insert(pendingDisposals).values(row);
}

// Tenant guard is applied by the caller (compares row.tenantId to msg.tenantId),
// mirroring the finance eoffice-consumer's findSanctionByIdTx pattern.
export async function findPendingDisposalByIdTx(tx: Writer, id: string): Promise<PendingDisposalRow | null> {
  const rows = await (tx as typeof db).select().from(pendingDisposals)
    .where(eq(pendingDisposals.id, id)).limit(1);
  return rows[0] ?? null;
}

// Used to block a second submission while one is already awaiting a decision.
export async function findActivePendingDisposal(tx: Writer, tenantId: string, assetId: string): Promise<PendingDisposalRow | null> {
  const rows = await (tx as typeof db).select().from(pendingDisposals)
    .where(and(
      eq(pendingDisposals.tenantId, tenantId),
      eq(pendingDisposals.assetId, assetId),
      eq(pendingDisposals.workflowStatus, "pending"),
    )).limit(1);
  return rows[0] ?? null;
}

export async function updatePendingDisposalStatus(tx: Writer, id: string, tenantId: string, workflowStatus: string): Promise<void> {
  await (tx as typeof db).update(pendingDisposals)
    .set({ workflowStatus })
    .where(and(eq(pendingDisposals.id, id), eq(pendingDisposals.tenantId, tenantId)));
}
