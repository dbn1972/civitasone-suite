import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PaymentRow } from "./schema.js";

function formatMinor(minor: bigint): string {
  return `₹${(Number(minor) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function mapPaymentStatus(status: string): PaymentSummary["status"] {
  if (status === "released" || status === "completed") return "Released";
  if (status === "failed") return "Failed";
  if (status === "pending_approval") return "Pending Approval";
  return "Queued";
}

export type PaymentSummary = {
  id: string;
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  status: "Queued" | "Released" | "Pending Approval" | "Failed";
};

export async function getPayment(id: string, tenantId: string): Promise<PaymentRow | null> {
  return cache.getOrLoad<PaymentRow>(
    cache.makeKey(tenantId, "payment", id),
    () => repo.findPaymentById(id)
  );
}

export async function listPayments(tenantId: string, limit: number, offset: number): Promise<{ data: PaymentSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "payment", `list:${limit}:${offset}`, async () => {
    const rows = await repo.listPaymentsByTenant(tenantId, limit, offset);
    return {
      data: rows.map((r) => ({
        id: r.id,
        referenceId: r.eftRef ?? r.id,
        beneficiary: `Bill ${r.billId.slice(0, 8)}`,
        amountDisplay: formatMinor(r.amountMinor),
        status: mapPaymentStatus(r.status),
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
