"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { GrantDetail } from "@civitasone/types";

type Installment = GrantDetail["installments"][number];
type UC = GrantDetail["ucs"][number];

type Col<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
};

async function postAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // Surface the server response so a missing/erroring endpoint is visible.
    throw new Error(
      `Action failed (${res.status}). ${txt.slice(0, 200) || "No response body."}`,
    );
  }
}

export function GrantInstallmentsTable({ installments }: { installments: Installment[] }) {
  const router = useRouter();

  const columns: Col<Installment>[] = [
    { key: "installmentNo", label: "Installment #", align: "right" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "scheduledDate", label: "Scheduled Date", render: (row) => formatIndianDate(row.scheduledDate) },
    {
      key: "releasedDate",
      label: "Released Date",
      render: (row) => (row.releasedDate ? formatIndianDate(row.releasedDate) : "—"),
    },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "id",
      label: "Action",
      align: "right",
      render: (row) =>
        row.status === "pending" ? (
          <ActionButton
            label="Release"
            className="btn primary sm"
            confirmTitle={`Release installment #${row.installmentNo}?`}
            confirmDescription={
              <>
                This initiates disbursement of <strong>{formatMoney(row.amount)}</strong> (mode:
                PFMS) and cannot be undone. A reason is recorded in the audit trail.
              </>
            }
            confirmLabel="Release funds"
            requireReason
            reasonLabel="Reason / approval reference (required)"
            onConfirm={async (reason) => {
              await postAction(`/api/proxy/v1/grants/installments/${row.id}/disburse`, {
                mode: "PFMS",
                beneficiaryBankRef: reason,
              });
              router.refresh();
            }}
          />
        ) : (
          <span aria-hidden="true">—</span>
        ),
    },
  ];

  return <DataTable<Installment> columns={columns} rows={installments} />;
}

export function GrantUCsTable({ ucs }: { ucs: UC[] }) {
  const router = useRouter();

  const columns: Col<UC>[] = [
    { key: "ucNo", label: "UC No" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "period", label: "Period" },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "id",
      label: "Action",
      align: "right",
      render: (row) => {
        const verifiable = row.status !== "verified" && row.status !== "validated";
        return verifiable ? (
          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
            <ActionButton
              label="Verify"
              className="btn primary sm"
              confirmTitle={`Verify UC ${row.ucNo}?`}
              confirmDescription={
                <>
                  Verifying confirms utilisation of <strong>{formatMoney(row.amount)}</strong> as
                  per GFR 2017. This decision is recorded in the audit trail.
                </>
              }
              confirmLabel="Verify UC"
              requireReason
              reasonLabel="Verification remarks (required)"
              onConfirm={async (reason) => {
                await postAction(`/api/proxy/v1/grants/utilization-certs/${row.id}/validate`, {
                  status: "validated",
                  remarks: reason,
                });
                router.refresh();
              }}
            />
            <ActionButton
              label="Reject"
              className="btn danger sm"
              danger
              confirmTitle={`Reject UC ${row.ucNo}?`}
              confirmDescription={
                <>
                  Rejecting returns UC <strong>{row.ucNo}</strong> to the grantee for correction. A
                  reason is mandatory and recorded in the audit trail.
                </>
              }
              confirmLabel="Reject UC"
              requireReason
              reasonLabel="Reason for rejection (required)"
              onConfirm={async (reason) => {
                await postAction(`/api/proxy/v1/grants/utilization-certs/${row.id}/validate`, {
                  status: "rejected",
                  remarks: reason,
                });
                router.refresh();
              }}
            />
          </span>
        ) : (
          <span aria-hidden="true">—</span>
        );
      },
    },
  ];

  return <DataTable<UC> columns={columns} rows={ucs} />;
}
