import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { IndentRow } from "./schema.js";

export async function getIndent(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const indent = await cache.getOrLoad<IndentRow | null>(
    cache.makeKey(tenantId, "indent", id),
    () => repo.findIndentById(id),
  );
  if (!indent || indent.tenantId !== tenantId) return null;

  const items = await repo.findIndentItemsByIndentId(id);
  return {
    ...indent,
    totalMinor: String(indent.totalMinor),
    lineItems: items.map((i) => ({
      itemCode: i.itemCode,
      itemName: i.description,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceMinor: Number(i.unitPriceMinor),
      estimatedUnitPrice: Number(i.unitPriceMinor),
      totalPrice: Number(i.unitPriceMinor) * i.quantity,
    })),
    approvalTrail: [],
  };
}

export async function listTenderRequiredIndents(tenantId: string, limit = 50): Promise<IndentRow[]> {
  return repo.findTenderRequiredIndents(tenantId, limit);
}

export async function listIndents(tenantId: string, limit = 50, offset = 0): Promise<IndentRow[]> {
  const result = await cache.getOrLoad<IndentRow[]>(
    cache.makeKey(tenantId, "indents", `list:${limit}:${offset}`),
    () => repo.findIndentsByTenant(tenantId, limit, offset),
  );
  return result ?? [];
}
