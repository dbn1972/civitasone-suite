"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { isUcVerified } from "@/lib/grants/ucStatus";
import type { GrantDetail } from "@civitasone/types";

type Installment = GrantDetail["installments"][number];
type UC = GrantDetail["ucs"][number];

type Col<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
};

/**
 * Plain-language failure message for a failed grant installment/UC action.
 * postAction is a plain async helper shared across the exported table
 * components below, not a component or hook, so it can't call the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on -- never the backend's own message/error text
 * or the raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function grantActionError(): string {
  const human = toHumanError("save", { area: "grant action" });
  return `${human.what} ${human.next}`;
}

async function postAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(grantActionError());
  }
}

/**
 * GAP-GRANTS-DETAIL-06: an empty Action cell must still carry an accessible
 * label — an `aria-hidden` dash leaves the cell silent for a screen reader.
 * Render a visually-hidden explanation plus the visible dash.
 */
function NoAction() {
  return (
    <>
      <span className="sr-only">No action available</span>
      <span aria-hidden="true">—</span>
    </>
  );
}

/**
 * GAP-GRANTS-DETAIL-01 / DETAIL-04: `canRelease` comes from the server
 * (session roles) — the Release control is only rendered for a grants maker.
 * `grantStatus` and `granteeName` come from the parent grant so the client can
 * (a) block release on a non-active grant and (b) name the payee in the
 * confirm dialog. The grant-service remains the authority on both the role and
 * the sequencing/budget/UC gates (see disbursement/consumer.ts).
 */
export function GrantInstallmentsTable({
  installments,
  grantStatus,
  granteeName,
  canRelease = false,
}: {
  installments: Installment[];
  grantStatus: GrantDetail["status"];
  granteeName?: string;
  canRelease?: boolean;
}) {
  const router = useRouter();

  // GAP-GRANTS-DETAIL-04: Release is only valid on an active grant, and only
  // for the lowest-numbered pending installment (tranches release in order).
  const grantActive = grantStatus === "active";
  const lowestPendingNo = installments
    .filter((i) => i.status === "pending")
    .reduce<number | null>((min, i) => (min === null || i.installmentNo < min ? i.installmentNo : min), null);

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
      render: (row) => {
        if (!canRelease || row.status !== "pending") return <NoAction />;

        const blockedReason = !grantActive
          ? `Grant is ${grantStatus}; releases are only allowed while active`
          : row.installmentNo !== lowestPendingNo
            ? `Release installment #${lowestPendingNo} first — tranches release in order`
            : null;

        if (blockedReason) {
          return (
            <button type="button" className="btn primary sm" disabled title={blockedReason} aria-label={`Release unavailable: ${blockedReason}`}>
              Release
            </button>
          );
        }

        return (
          <ActionButton
            label="Release"
            className="btn primary sm"
            confirmTitle={`Release installment #${row.installmentNo}?`}
            confirmDescription={
              <>
                This initiates disbursement of <strong>{formatMoney(row.amount)}</strong> (mode:
                PFMS) to <strong>{granteeName ?? "the grantee"}</strong> and cannot be undone. A
                reason is recorded in the audit trail.
              </>
            }
            confirmLabel="Release funds"
            requireReason
            reasonLabel="Reason / approval reference (required)"
            onConfirm={async (reason) => {
              // GAP-GRANTS-DETAIL-03: the reason is the audit/approval reference,
              // NOT the payee bank ref. Send it as `reason`; the grantee's bank
              // account is resolved server-side from the grantee master.
              await postAction(`/api/proxy/v1/grants/installments/${row.id}/disburse`, {
                mode: "PFMS",
                reason,
              });
              router.refresh();
            }}
          />
        );
      },
    },
  ];

  return <DataTable<Installment> columns={columns} rows={installments} />;
}

/**
 * GAP-GRANTS-DETAIL-01: Verify/Reject are only rendered for a grants UC
 * verifier (server-provided `canVerify`). The server still enforces the role.
 */
export function GrantUCsTable({ ucs, canVerify = false }: { ucs: UC[]; canVerify?: boolean }) {
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
        // GAP-GRANTS-DETAIL-05: "validated" and "verified" both mean accepted.
        const verifiable = canVerify && !isUcVerified(row.status) && row.status !== "rejected";
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
          <NoAction />
        );
      },
    },
  ];

  return <DataTable<UC> columns={columns} rows={ucs} />;
}
