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

function mapBillStatus(status: string): "pending" | "approved" | "paid" | "rejected" | "under_review" {
  if (status === "approved") return "approved";
  if (status === "paid") return "paid";
  if (status === "rejected") return "rejected";
  if (status === "under_review") return "under_review";
  return "pending";
}

export async function listBillSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "bills", `list:${limit}`),
    () => repo.listBillsByTenant(tenantId, limit),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    billNo: row.billNo,
    vendor: row.vendorId,
    amount: Number(row.netMinor) / 100,
    submittedDate: row.createdAt.toISOString().slice(0, 10),
    dueDate: undefined,
    status: mapBillStatus(row.status),
    poRef: row.poRef ?? undefined,
    threeWayMatch: "na" as const,
  }));
}

export async function listAdvances(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "advances", `list:${limit}`),
    () => repo.listAdvancesByTenant(tenantId, limit),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    advanceNo: row.advanceNo,
    beneficiary: row.beneficiary,
    type: (row.type as "employee" | "vendor" | "other"),
    amount: Number(row.amountMinor) / 100,
    disbursedDate: String(row.disbursedDate),
    dueDate: row.dueDate ? String(row.dueDate) : undefined,
    adjustedAmount: Number(row.adjustedMinor) / 100,
    balance: (Number(row.amountMinor) - Number(row.adjustedMinor)) / 100,
    status: (row.status as "active" | "adjusted" | "overdue" | "closed"),
  }));
}

export async function listUCs(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "uc", `list:${limit}`),
    () => repo.listUCsByTenant(tenantId, limit),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    ucNo: row.ucNo,
    grantRef: row.grantRef ?? undefined,
    grantee: row.grantee,
    amount: Number(row.amountMinor) / 100,
    periodFrom: String(row.periodFrom),
    periodTo: String(row.periodTo),
    submittedDate: row.submittedDate ? String(row.submittedDate) : undefined,
    status: (row.status as "pending" | "submitted" | "verified" | "rejected"),
  }));
}

export async function getBillDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "bill", id),
    () => repo.findBillById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;
  return {
    id: row.id,
    billNo: row.billNo,
    vendor: row.vendorId,
    amount: Number(row.netMinor) / 100,
    submittedDate: row.createdAt.toISOString().slice(0, 10),
    status: mapBillStatus(row.status),
    poRef: row.poRef ?? undefined,
    grnRef: row.grnRef ?? undefined,
    lineItems: [],
  };
}
