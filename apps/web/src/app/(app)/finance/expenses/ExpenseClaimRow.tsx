"use client";

import { StatusPill } from "@/app/_components/ds";

export type ExpenseClaim = {
  id: string;
  employeeName: string;
  employeeCode: string;
  category: "office_supplies" | "communication" | "misc";
  description: string;
  amount: number;
  currency: string;
  receiptAttached: boolean;
  ddoCountersigned: boolean;
  status: "draft" | "pending" | "approved" | "rejected";
  submittedDate: string;
};

const CATEGORY_LABELS: Record<ExpenseClaim["category"], string> = {
  office_supplies: "Office Supplies",
  communication: "Communication",
  misc: "Miscellaneous",
};

interface ExpenseClaimRowProps {
  claim: ExpenseClaim;
}

export function ExpenseClaimRow({ claim }: ExpenseClaimRowProps) {
  const amountDisplay = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: claim.currency ?? "INR",
    maximumFractionDigits: 0,
  }).format(claim.amount);

  return (
    <tr>
      <td className="font-mono text-sm">{claim.id}</td>
      <td>
        <div className="font-medium">{claim.employeeName}</div>
        <div className="text-xs text-gray-500">{claim.employeeCode}</div>
      </td>
      <td>{CATEGORY_LABELS[claim.category]}</td>
      <td className="max-w-xs truncate" title={claim.description}>{claim.description}</td>
      <td className="text-right font-mono">{amountDisplay}</td>
      <td className="text-center">
        <span aria-label={claim.receiptAttached ? "Receipt attached" : "No receipt"}>
          {claim.receiptAttached ? "Yes" : "No"}
        </span>
      </td>
      <td className="text-center">
        <span aria-label={claim.ddoCountersigned ? "DDO countersigned" : "Pending DDO countersignature"}>
          {claim.ddoCountersigned ? "Yes" : "Pending"}
        </span>
      </td>
      <td>{new Date(claim.submittedDate).toLocaleDateString("en-IN")}</td>
      <td><StatusPill status={claim.status} /></td>
    </tr>
  );
}
