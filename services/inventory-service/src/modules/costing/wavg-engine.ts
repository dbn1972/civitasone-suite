/**
 * WAVG (Weighted Average) Cost-Layer Engine — pure domain logic.
 *
 * Recomputes the weighted average unit cost on each receipt using bigint paise
 * arithmetic (floor division). The resulting rate applies to all subsequent
 * issues until the next receipt.
 *
 * Formula: newUnitCost = (existingQty × existingRate + receiptQty × receiptRate) / (existingQty + receiptQty)
 *
 * Edge cases:
 *   - Combined quantity is zero → unitCostPaise = 0n
 *   - Existing qty is zero (first receipt) → unitCostPaise = receipt rate
 *   - Receipt qty is zero → no-op (returns existing state unchanged)
 *
 * All cost values are bigint paise — no floating-point arithmetic.
 *
 * Validates: Requirements 14.4
 */

/** Current WAVG state for an item/warehouse combination. */
export interface WavgState {
  /** Total quantity on hand. */
  qty: number;
  /** Total cost of on-hand stock in paise. */
  totalCostPaise: bigint;
  /** Weighted average unit cost in paise (totalCostPaise / qty, floor division). */
  unitCostPaise: bigint;
}

/** A receipt to incorporate into the weighted average. */
export interface WavgReceipt {
  /** Quantity received (must be >= 0). */
  qty: number;
  /** Unit cost of the received goods in paise. */
  unitCostPaise: bigint;
}

/**
 * Recompute the weighted average cost given the existing state and a new receipt.
 *
 * - When receipt qty is zero, returns existing state unchanged (no-op).
 * - When existing qty is zero (first receipt), sets rate directly from receipt.
 * - When combined qty is zero, rate is zero.
 * - Uses bigint floor division — never float.
 *
 * @param existing - Current WAVG state (qty, totalCostPaise, unitCostPaise).
 * @param receipt - The incoming receipt (qty, unitCostPaise).
 * @returns New WavgState with recomputed weighted average.
 */
export function recomputeWavg(existing: WavgState, receipt: WavgReceipt): WavgState {
  // Zero receipt qty → no-op
  if (receipt.qty === 0) {
    return { ...existing };
  }

  const newQty = existing.qty + receipt.qty;

  // Guard: combined quantity zero (shouldn't happen with receipt.qty > 0 and
  // existing.qty >= 0, but defensive)
  if (newQty === 0) {
    return { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
  }

  // Compute new total cost: existing value + receipt value
  const existingValue = BigInt(existing.qty) * existing.unitCostPaise;
  const receiptValue = BigInt(receipt.qty) * receipt.unitCostPaise;
  const newTotalCostPaise = existingValue + receiptValue;

  // Weighted average unit cost via bigint floor division
  const newUnitCostPaise = newTotalCostPaise / BigInt(newQty);

  return {
    qty: newQty,
    totalCostPaise: newTotalCostPaise,
    unitCostPaise: newUnitCostPaise,
  };
}
