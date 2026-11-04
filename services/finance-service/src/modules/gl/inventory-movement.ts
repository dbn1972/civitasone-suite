/**
 * UAT L2-N6: inventory-service stock movements -> GL.
 *
 * inventory-service publishes finance.gl.post { type: "inventory_movement",
 * movementId, kind: "receipt" | "issue", totalMinor (paise, decimal string) }
 * -- since this fix also postingDate, storeId, refDoc and refNo -- for every
 * stock receipt (manual, or the auto receipt of an accepted GRN) and issue.
 * Finance had no branch for it: the message fell into the generic path, was
 * refused as JOURNAL_TOO_FEW_LINES and dead-lettered (outbox e6932aac, GRN
 * accept of SKU G4X13257), so stock was never valued in the GL.
 *
 *   receipt: Dr Stores / Inventory          Cr GRN clearing (goods received not invoiced)
 *   issue:   Dr Stores consumption expense  Cr Stores / Inventory
 *
 * GRN clearing is the SAME head the bill drafted from the accepted GRN debits
 * (grnBillHeadCode, FINANCE_GRN_BILL_HEAD_CODE): the receipt credits it, the
 * bill (procurement.grn.accepted -> finance.bill.create, 3-way matched on the
 * GRN ref) debits it, so once the bill posts the stocked value sits in
 * Inventory and Accounts Payable and the clearing head nets to zero. Point
 * FINANCE_GRN_BILL_HEAD_CODE at a GRNI liability head to see open receipts not
 * yet billed; on the default expense head the receipt reclassifies the stocked
 * part of the purchase from expense to inventory.
 *
 * The journal id is deterministic per movement (inventory_movement:<id>), so a
 * redelivery or a re-driven dead letter posts exactly once. Pure.
 */
import { deterministicId } from "./spine.js";
import { STORES_INVENTORY, STORES_CONSUMPTION, grnBillHeadCode } from "./system-heads.js";
import type { JournalLine } from "./schema.js";

export const INVENTORY_MOVEMENT_TYPE = "inventory_movement";

export interface InventoryMovementJournal {
  id: string;
  voucherNo: string;
  type: typeof INVENTORY_MOVEMENT_TYPE;
  postingDate: string;
  lines: JournalLine[];
  sourceRef: string;
  source: Record<string, unknown>;
}

export class InventoryMovementPayloadError extends Error {
  constructor(message: string) {
    super(`INVENTORY_MOVEMENT_PAYLOAD: ${message}`);
    this.name = "InventoryMovementPayloadError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR = /^\d{1,18}$/;

/**
 * The journal for one inventory movement. `today` is the posting date of a
 * message that predates postingDate on the wire (the dead letters of
 * 2026-10-28 / 2026-11-04). Throws InventoryMovementPayloadError on a payload
 * that can never post (a retry cannot fix it).
 */
export function inventoryMovementJournal(raw: Record<string, unknown>, today: string): InventoryMovementJournal {
  const movementId = raw.movementId;
  if (typeof movementId !== "string" || !UUID.test(movementId)) throw new InventoryMovementPayloadError("movementId must be a uuid");
  const kind = raw.kind;
  if (kind !== "receipt" && kind !== "issue") throw new InventoryMovementPayloadError(`kind must be receipt or issue, got ${String(kind)}`);
  const total = typeof raw.totalMinor === "number" && Number.isSafeInteger(raw.totalMinor) ? String(raw.totalMinor) : raw.totalMinor;
  if (typeof total !== "string" || !MINOR.test(total)) throw new InventoryMovementPayloadError("totalMinor must be a non-negative integer paise string");
  const postingDate = typeof raw.postingDate === "string" && DATE.test(raw.postingDate) ? raw.postingDate : today;
  const amount = BigInt(total).toString();
  const clearing = grnBillHeadCode();
  const refDoc = typeof raw.refDoc === "string" ? raw.refDoc : undefined;
  const refNo = typeof raw.refNo === "string" ? raw.refNo : undefined;
  const ref = refDoc && refNo ? ` (${refDoc} ${refNo})` : "";
  const lines: JournalLine[] = kind === "receipt"
    ? [
        { accountCode: STORES_INVENTORY, debitMinor: amount, creditMinor: "0", narration: `Stock received${ref}` },
        { accountCode: clearing, debitMinor: "0", creditMinor: amount, narration: `Goods received not invoiced${ref}` },
      ]
    : [
        { accountCode: STORES_CONSUMPTION, debitMinor: amount, creditMinor: "0", narration: `Stores consumed${ref}` },
        { accountCode: STORES_INVENTORY, debitMinor: "0", creditMinor: amount, narration: `Stock issued${ref}` },
      ];
  const sourceRef = `${INVENTORY_MOVEMENT_TYPE}:${movementId}`;
  return {
    id: deterministicId(sourceRef),
    voucherNo: `INV/${kind === "receipt" ? "RCPT" : "ISSUE"}/${movementId.slice(0, 8).toUpperCase()}`,
    type: INVENTORY_MOVEMENT_TYPE,
    postingDate,
    lines,
    sourceRef,
    source: { kind: INVENTORY_MOVEMENT_TYPE, movementId, movementKind: kind, amountMinor: amount, ...(refDoc ? { refDoc } : {}), ...(refNo ? { refNo } : {}) },
  };
}
