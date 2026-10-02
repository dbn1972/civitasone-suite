/**
 * movements query handlers (READ PATH) — read-through cache, tenant-scoped.
 * Money (paise) is serialised to strings so JSON stays lossless.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { suggestedReorderQty } from "./domain.js";
import type { MovementRow } from "./schema.js";
import type { LedgerOpts } from "./repo.js";

/**
 * Fetch a movement header by id — the caller's only way to learn the
 * outcome of an async receipt/issue/transfer/adjustment (mirrors
 * getBatch/getItem/getGoodsReturn). A rejected or still-in-retry command
 * never persists a row (assertSufficientStock/DomainError checks abort the
 * whole transaction), so this reads as "not found" the same way a rejected
 * batch.issue or srn.create does for its sibling modules.
 */
export async function getMovement(tenantId: string, id: string): Promise<MovementRow | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE.movement, id), () => repo.getMovement(tenantId, id));
}

export type BalanceView = {
  itemId: string; storeId: string; onHandQty: number;
  avgRateMinor: string; valueMinor: string; currency: string;
};

export async function listBalances(
  tenantId: string, opts: { itemId?: string; storeId?: string; limit: number; offset: number },
): Promise<{ data: BalanceView[] }> {
  const hash = `list:${opts.itemId ?? ""}:${opts.storeId ?? ""}:${opts.limit}:${opts.offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.balance, hash, async () => {
    const rows = await repo.listBalances(tenantId, opts);
    // A FIFO item's stockBalances.avgRateMinor is only a derived reference rate
    // (floor-divided, for display/back-compat); the authoritative value is the
    // sum of its remaining cost layers at their original rates, not qty × rate.
    const fifoItemIds = rows.filter((r) => r.valuationMethod === "FIFO").map((r) => r.itemId);
    const fifoValues = await repo.sumOpenLayerValues(tenantId, fifoItemIds);
    return {
      data: rows.map((r) => {
        const valueMinor = r.valuationMethod === "FIFO"
          ? fifoValues.get(`${r.itemId}|${r.storeId}`) ?? 0n
          : BigInt(r.onHandQty) * r.avgRateMinor;
        return {
          itemId: r.itemId, storeId: r.storeId, onHandQty: r.onHandQty,
          avgRateMinor: r.avgRateMinor.toString(),
          valueMinor: valueMinor.toString(),
          currency: r.currency,
        };
      }),
    };
  });
}

export async function listLedger(
  tenantId: string, opts: LedgerOpts,
): Promise<{ data: Array<Record<string, unknown>> }> {
  const hash = `list:${opts.itemId ?? ""}:${opts.storeId ?? ""}:${opts.movementType ?? ""}:${opts.from ?? ""}:${opts.to ?? ""}:${opts.limit}:${opts.offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.ledger, hash, async () => {
    const rows = await repo.listLedger(tenantId, opts);
    return {
      data: rows.map((r) => ({
        ...r,
        rateMinor: r.rateMinor.toString(),
        valueMinor: r.valueMinor.toString(),
      })),
    };
  });
}

export type LowStockView = {
  itemId: string; storeId: string; name: string; sku: string | null;
  onHandQty: number; reorderLevel: number; suggestedReorderQty: number;
};

export async function listLowStock(tenantId: string, limit: number, offset: number): Promise<{ data: LowStockView[] }> {
  const hash = `list:${limit}:${offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.lowStock, hash, async () => {
    const rows = await repo.listLowStock(tenantId, limit, offset);
    return {
      data: rows.map((r) => ({
        itemId: r.itemId, storeId: r.storeId, name: r.name, sku: r.sku,
        onHandQty: r.onHandQty, reorderLevel: r.reorderLevel,
        suggestedReorderQty: suggestedReorderQty(r.onHandQty, r.reorderLevel, r.reorderQty),
      })),
    };
  });
}
