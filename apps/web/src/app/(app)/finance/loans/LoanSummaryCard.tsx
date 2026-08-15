"use client";

import { Card, StatusPill } from "@/app/_components/ds";

export type LoanType = "hba" | "vehicle" | "computer" | "festival";

export type LoanRecord = {
  id: string;
  employeeName: string;
  employeeCode: string;
  loanType: LoanType;
  sanctionedAmount: number;
  outstandingBalance: number;
  emiAmount: number;
  interestRate: number;
  nextDueDate: string | null;
  totalInterestPayable: number;
  tenureMonths: number;
  paidMonths: number;
  status: "active" | "closed" | "overdue" | "pending";
  currency: string;
};

const LOAN_META: Record<LoanType, { label: string; icon: string; maxNote: string; chapter: string }> = {
  hba: {
    label: "House Building Advance",
    icon: "🏠",
    maxNote: "Max as per pay level (GFR 2017 Ch.23)",
    chapter: "GFR 2017 Chapter 23",
  },
  vehicle: {
    label: "Vehicle Loan",
    icon: "🚗",
    maxNote: "Two-wheeler / Four-wheeler per schedule",
    chapter: "GFR 2017 Chapter 23",
  },
  computer: {
    label: "Computer Advance",
    icon: "💻",
    maxNote: "Once every 5 years",
    chapter: "GFR 2017 Chapter 23",
  },
  festival: {
    label: "Festival Advance",
    icon: "🎊",
    maxNote: "Interest-free, recoverable in 10 instalments",
    chapter: "GFR 2017 Chapter 23",
  },
};

function formatINR(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface LoanSummaryCardProps {
  loan: LoanRecord;
}

export function LoanSummaryCard({ loan }: LoanSummaryCardProps) {
  const meta = LOAN_META[loan.loanType];
  const progressPct =
    loan.tenureMonths > 0 ? Math.round((loan.paidMonths / loan.tenureMonths) * 100) : 0;

  return (
    <Card
      title={`${meta.icon} ${meta.label}`}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-sm">{loan.employeeName}</div>
            <div className="text-xs text-gray-500">{loan.employeeCode} · {meta.chapter}</div>
          </div>
          <StatusPill status={loan.status} />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Sanctioned</dt>
            <dd className="font-mono font-medium mt-0.5">{formatINR(loan.sanctionedAmount, loan.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Outstanding</dt>
            <dd className="font-mono font-medium mt-0.5 text-red-700">{formatINR(loan.outstandingBalance, loan.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Monthly EMI</dt>
            <dd className="font-mono font-medium mt-0.5">{formatINR(loan.emiAmount, loan.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Interest Rate</dt>
            <dd className="font-mono font-medium mt-0.5">{loan.interestRate}% p.a.</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Next Due</dt>
            <dd className="font-medium mt-0.5">
              {loan.nextDueDate
                ? new Date(loan.nextDueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Total Interest</dt>
            <dd className="font-mono mt-0.5 text-gray-700">{formatINR(loan.totalInterestPayable, loan.currency)}</dd>
          </div>
        </dl>

        {loan.tenureMonths > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Repayment progress</span>
              <span>{loan.paidMonths}/{loan.tenureMonths} months ({progressPct}%)</span>
            </div>
            <div
              className="h-2 rounded-full bg-gray-200 overflow-hidden"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Loan repayment progress: ${progressPct}%`}
            >
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400">{meta.maxNote}</p>
      </div>
    </Card>
  );
}
