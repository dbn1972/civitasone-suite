/**
 * FIFO Cost-Layer Engine — pure domain logic.
 *
 * Consumes cost layers in receipt-date order (oldest first), fully depleting
 * each layer before moving to the next. Rejects issues where the requested
 * quantity exceeds total available stock across all layers.
 *
 * All cost values are bigint paise — no floating-point arithmetic.
 *
 * Validates: Requirements 14.2, 14.3
 */
import { DomainError } from "../../shared/domain.js";

/** A cost layer available for consumption. */
export interface CostLayer {
  id: string;
  receiptDate: Date;
  qty: number;
  remainingQty: number;
  unitCostPaise: bigint;
}

/** A record of quantity consumed from a single layer. */
export interface ConsumedLayer {
  layerId: string;
  qty: number;
  unitCostPaise: bigint;
}

/** Result of a FIFO consumption operation. */
export interface ConsumeResult {
  /** Layers that were (partially or fully) consumed. */
  consumed: ConsumedLayer[];
  /** Total cost of the consumed quantity in paise. */
  totalCostPaise: bigint;
  /** Updated layers with adjusted remainingQty (layers fully depleted are excluded). */
  remaining: CostLayer[];
}

/**
 * Consume stock layers in FIFO order (oldest receipt date first).
 *
 * - Layers are sorted by receiptDate ascending.
 * - Each layer is fully depleted before moving to the next.
 * - Throws DomainError("INSUFFICIENT_STOCK") if issueQty exceeds the sum of
 *   all remainingQty values across provided layers.
 *
 * @param layers - Available cost layers (need not be pre-sorted).
 * @param issueQty - Quantity to consume (must be > 0).
 * @returns ConsumeResult with consumed details, total cost, and remaining layers.
 */
export function consumeFifo(layers: CostLayer[], issueQty: number): ConsumeResult {
  if (issueQty <= 0) {
    throw new DomainError("INVALID_ISSUE_QTY", "Issue quantity must be greater than zero");
  }

  // Sort layers by receipt date ascending (oldest first) for FIFO
  const sorted = [...layers].sort(
    (a, b) => a.receiptDate.getTime() - b.receiptDate.getTime(),
  );

  // Check total available quantity
  const totalAvailable = sorted.reduce((sum, layer) => sum + layer.remainingQty, 0);
  if (issueQty > totalAvailable) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      `Issue qty ${issueQty} exceeds available balance ${totalAvailable}`,
    );
  }

  const consumed: ConsumedLayer[] = [];
  const remaining: CostLayer[] = [];
  let leftToConsume = issueQty;
  let totalCostPaise = 0n;

  for (const layer of sorted) {
    if (leftToConsume <= 0) {
      // No more to consume — keep layer as-is
      remaining.push({ ...layer });
      continue;
    }

    const take = Math.min(leftToConsume, layer.remainingQty);
    consumed.push({
      layerId: layer.id,
      qty: take,
      unitCostPaise: layer.unitCostPaise,
    });
    totalCostPaise += BigInt(take) * layer.unitCostPaise;
    leftToConsume -= take;

    const newRemaining = layer.remainingQty - take;
    if (newRemaining > 0) {
      // Layer partially consumed — keep with updated remaining
      remaining.push({ ...layer, remainingQty: newRemaining });
    }
    // If newRemaining === 0, layer is fully depleted — excluded from remaining
  }

  return { consumed, totalCostPaise, remaining };
}
