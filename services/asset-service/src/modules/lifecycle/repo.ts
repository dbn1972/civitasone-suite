import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  assetAcquisitions, assetTransfers, assetDisposals,
  type AcquisitionInsert, type TransferInsert, type DisposalInsert,
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
