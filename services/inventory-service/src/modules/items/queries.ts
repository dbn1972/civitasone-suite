/**
 * Query handlers (READ PATH) — read-through cache, always tenant-scoped.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ItemView, CategoryRow, UomRow, ItemSubstituteRow, BinRow, ReservationRow, GoodsReturnRow } from "./schema.js";

export async function getItem(tenantId: string, id: string): Promise<ItemView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE.item, id), () => repo.findItemView(id, tenantId));
}

export async function listItems(
  tenantId: string,
  opts: { categoryId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: ItemView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const hash = `list:${opts.categoryId ?? ""}:${opts.status ?? ""}:${opts.limit}:${opts.offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.item, hash, async () => {
    const rows = await repo.listItemViews(tenantId, opts);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === opts.limit,
        pageSize: opts.limit,
        ...(rows.length ? { cursor: String(opts.offset + rows.length) } : {}),
      },
    };
  });
}

export async function listCategories(tenantId: string, limit: number, offset: number): Promise<CategoryRow[]> {
  const hash = `list:${limit}:${offset}`;
  return (await cache.listOrLoad(tenantId, RESOURCE.category, hash, () => repo.listCategories(tenantId, limit, offset))) ?? [];
}

export async function listUoms(tenantId: string, limit: number, offset: number): Promise<UomRow[]> {
  const hash = `list:${limit}:${offset}`;
  return (await cache.listOrLoad(tenantId, RESOURCE.uom, hash, () => repo.listUoms(tenantId, limit, offset))) ?? [];
}

export async function listSubstitutes(tenantId: string, itemId: string): Promise<ItemSubstituteRow[]> {
  return repo.listSubstitutes(tenantId, itemId);
}

export async function listBins(tenantId: string, limit: number, offset: number): Promise<BinRow[]> {
  return repo.listBins(tenantId, limit, offset);
}

export async function listReservations(tenantId: string, limit: number, offset: number): Promise<ReservationRow[]> {
  return repo.listReservations(tenantId, limit, offset);
}

export async function listGoodsReturns(tenantId: string, limit: number, offset: number): Promise<GoodsReturnRow[]> {
  return repo.listGoodsReturns(tenantId, limit, offset);
}
