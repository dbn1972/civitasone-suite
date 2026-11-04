/**
 * UAT L2-N6 (+ review, ERP-head decision under the owner delegated authority): inventory-service stock movements.
 *
 * inventory-service publishes finance.gl.post { type: "inventory_movement", movementId, kind: "receipt" | "issue",
 * totalMinor, postingDate, storeId?, refDoc?, refNo? } for every stock receipt (manual, or the auto receipt of an
 * accepted GRN: refDoc "GRN", refNo = GRN id) and issue. What finance does depends on the tenant accounting basis
 * (gl.finance_settings.accounting_basis, migration 0160):
 *
 *  - cash (DEFAULT, Indian government accounts): NO journal. Expenditure is booked against the budget head when the
 *    bill is passed (unchanged); stores are a memorandum. The movement is recorded in gl.stores_valuation_memo and the
 *    message is acknowledged (idempotent by movement id).
 *  - accrual:
 *      GRN receipt      Dr Stores / Inventory 1400       Cr GRNI 2080 (liability)  -- cleared by the GRN bill (grni-clearing.ts)
 *      other receipt    Dr Stores / Inventory 1400       Cr Stores suspense 2085   -- opening stock, store return, inter-office
 *      issue            Dr the consuming head (expenseHeadCode on the payload) or Stores consumed 5300 (+ a warning)
 *                       Cr Stores / Inventory 1400
 *    A legacy message (no postingDate / refDoc -- the dead letters of 2026-10-28 / 11-04) cannot be told GRN from
 *    non-GRN, so on accrual it is refused (held in the DLQ) rather than guessed.
 *
 * The journal id is deterministic per movement (inventory_movement:<id>) and the voucher is AUTO (the gapless series,
 * allocated by postJournal only after its idempotency check). Pure.
 */
import { deterministicId } from "./spine.js";
import { STORES_INVENTORY, STORES_CONSUMPTION, GRNI, STORES_SUSPENSE } from "./system-heads.js";
import type { JournalLine } from "./schema.js";

export const INVENTORY_MOVEMENT_TYPE = "inventory_movement";

/** One stock movement as finance records it (gl.stores_valuation_memo). */
export interface StoresMovement {
  movementId: string;
  kind: "receipt" | "issue";
  totalMinor: string;
  postingDate: string;
  storeId: string | null;
  refDoc: string | null;
  refNo: string | null;
  expenseHeadCode: string | null;
  /** No postingDate on the wire: a pre-fix message (posting date = the re-drive day, refDoc unknown). */
  legacy: boolean;
}

export interface InventoryMovementJournal {
  id: string;
  voucherNo: "AUTO";
  type: typeof INVENTORY_MOVEMENT_TYPE;
  postingDate: string;
  lines: JournalLine[];
  sourceRef: string;
  source: Record<string, unknown>;
  /** Run warnings (e.g. an issue that names no consuming head). */
  warnings: string[];
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
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

/** Parse the wire payload; throws InventoryMovementPayloadError on one that can never be recorded. */
export function parseInventoryMovement(raw: Record<string, unknown>, today: string): StoresMovement {
  const movementId = raw.movementId;
  if (typeof movementId !== "string" || !UUID.test(movementId)) throw new InventoryMovementPayloadError("movementId must be a uuid");
  const kind = raw.kind;
  if (kind !== "receipt" && kind !== "issue") throw new InventoryMovementPayloadError(`kind must be receipt or issue, got ${String(kind)}`);
  const total = typeof raw.totalMinor === "number" && Number.isSafeInteger(raw.totalMinor) ? String(raw.totalMinor) : raw.totalMinor;
  if (typeof total !== "string" || !MINOR.test(total)) throw new InventoryMovementPayloadError("totalMinor must be a non-negative integer paise string");
  const dated = typeof raw.postingDate === "string" && DATE.test(raw.postingDate);
  const storeId = str(raw.storeId);
  return {
    movementId, kind, totalMinor: BigInt(total).toString(),
    postingDate: dated ? (raw.postingDate as string) : today,
    storeId: storeId && UUID.test(storeId) ? storeId : null,
    refDoc: str(raw.refDoc), refNo: str(raw.refNo), expenseHeadCode: str(raw.expenseHeadCode),
    legacy: !dated,
  };
}

/** A receipt of an accepted GRN (the only receipts that clear GRNI). */
export function grnIdOf(m: StoresMovement): string | null {
  return m.kind === "receipt" && m.refDoc === "GRN" && m.refNo && UUID.test(m.refNo) ? m.refNo : null;
}

/** The ACCRUAL-basis journal for one movement. Throws InventoryMovementPayloadError for a legacy receipt. */
export function accrualJournal(m: StoresMovement): InventoryMovementJournal {
  const amount = m.totalMinor;
  const ref = m.refDoc && m.refNo ? ` (${m.refDoc} ${m.refNo})` : "";
  const warnings: string[] = [];
  let lines: JournalLine[];
  if (m.kind === "receipt") {
    if (m.legacy) {
      throw new InventoryMovementPayloadError(`legacy receipt ${m.movementId} carries no refDoc: GRN or non-GRN cannot be told on the accrual basis; post it by hand`);
    }
    const grn = grnIdOf(m) != null;
    lines = [
      { accountCode: STORES_INVENTORY, debitMinor: amount, creditMinor: "0", narration: `Stock received${ref}` },
      grn
        ? { accountCode: GRNI, debitMinor: "0", creditMinor: amount, narration: `Goods received not invoiced${ref}` }
        : { accountCode: STORES_SUSPENSE, debitMinor: "0", creditMinor: amount, narration: `Stores receipt without GRN${ref}` },
    ];
  } else {
    const head = m.expenseHeadCode ?? STORES_CONSUMPTION;
    if (!m.expenseHeadCode) warnings.push("ISSUE_NO_CONSUMING_HEAD");
    lines = [
      { accountCode: head, debitMinor: amount, creditMinor: "0", narration: `Stores consumed${ref}` },
      { accountCode: STORES_INVENTORY, debitMinor: "0", creditMinor: amount, narration: `Stock issued${ref}` },
    ];
  }
  const sourceRef = `${INVENTORY_MOVEMENT_TYPE}:${m.movementId}`;
  return {
    id: deterministicId(sourceRef),
    voucherNo: "AUTO",
    type: INVENTORY_MOVEMENT_TYPE,
    postingDate: m.postingDate,
    lines,
    sourceRef,
    source: { kind: INVENTORY_MOVEMENT_TYPE, movementId: m.movementId, movementKind: m.kind, amountMinor: amount, ...(m.refDoc ? { refDoc: m.refDoc } : {}), ...(m.refNo ? { refNo: m.refNo } : {}) },
    warnings,
  };
}
