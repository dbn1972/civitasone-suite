import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PoRow } from "./schema.js";

export async function getPo(id: string, tenantId: string): Promise<PoRow | null> {
  return cache.getOrLoad<PoRow>(
    cache.makeKey(tenantId, "po", id),
    () => repo.findPoById(id)
  );
}

export async function listPos(tenantId: string, limit: number): Promise<{ data: Array<{ id: string; vendor: string; amountDisplay: string; status: "Pending" | "Approved" | "Review" | "Rejected" }> }> {
  const rows = await repo.listPosByTenant(tenantId, limit);
  return {
    data: rows.map((r) => ({
      id: r.poNo,
      vendor: r.vendorId.slice(0, 8),
      amountDisplay: `₹${(Number(r.totalMinor) / 100).toLocaleString("en-IN")}`,
      status: r.status === "approved" ? "Approved" as const : r.status === "rejected" ? "Rejected" as const : r.status === "draft" ? "Review" as const : "Pending" as const,
    })),
  };
}
