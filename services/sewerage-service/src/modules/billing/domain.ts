export type BillStatus = "generated" | "sent" | "paid" | "overdue";

const TRANSITIONS: Record<BillStatus, BillStatus[]> = {
  generated: ["sent"],
  sent: ["paid", "overdue"],
  overdue: ["paid"],
  paid: [],
};

export function validateBillTransition(from: BillStatus, to: BillStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid bill transition: ${from} → ${to}`;
  return null;
}
