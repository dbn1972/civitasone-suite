/**
 * Transfer-row types and pure helpers for /hr/payroll/disbursement.
 *
 * Deliberately NOT a "use client" module (review D1): page.tsx is a Server
 * Component and calls toClientTransferRow / isCreditedTransfer /
 * isFailedTransfer on the server. In Next 14 every export of a "use client"
 * file is a client reference when imported by a server module, so calling
 * one there throws at request time ("Attempted to call ... from the server").
 * Both the page and the client table import from here.
 */

/**
 * Ledger status from payroll.disbursement_transfers (payroll-service
 * disbursement-transfers/schema.ts): pending = queued for the next bank file
 * (e.g. a retry), sent = in a generated file / outcome unknown, success =
 * credited, failed / returned = money did not land (retryable).
 */
export type TransferStatus = "pending" | "sent" | "success" | "failed" | "returned";

export const isCreditedTransfer = (status: string): boolean => status === "success";
export const isFailedTransfer = (status: string): boolean => status === "failed" || status === "returned";
export const isInFlightTransfer = (status: string): boolean => status === "pending" || status === "sent";

/**
 * Raw row as returned by GET /v1/payroll/disbursement/transfers. Only ever
 * read on the SERVER (page.tsx) -- it is never passed to the client
 * table as-is, because a client component's props are serialised into
 * the RSC payload: a full account number handed to the browser is exposed
 * even if the table renders it masked (GAP-PAYROLL-DISBURSEMENT-01).
 */
export type RawTransferRow = {
  id: string;
  employeeId?: string;
  employeeName: string;
  /** Never sent by the API (it stores last-4 only); kept so a raw value can never slip through unmasked. */
  accountNumber?: string | null;
  /** What the API sends: "XXXX1234" (server-side mask, last 4 only). */
  accountNumberMasked?: string | null;
  ifsc: string;
  /** Authoritative amount: integer paise as a string. */
  amountPaise?: string;
  /** Display rupees derived by the API from amountPaise. */
  amountRupees: number;
  status: TransferStatus | string;
  nachBatchId: string | null;
  failureReason: string | null;
};

/** The client-safe row: account reduced to its last 4 digits, no employee UUID. */
export type TransferRow = {
  id: string;
  employeeName: string;
  accountLast4: string | null;
  ifsc: string;
  amountRupees: number;
  status: TransferStatus | string;
  nachBatchId: string | null;
  failureReason: string | null;
};

function rupeesOf(raw: RawTransferRow): number {
  // Prefer the paise string (exact) over the API's derived rupee number.
  if (typeof raw.amountPaise === "string" && /^-?\d+$/.test(raw.amountPaise)) {
    return Number(BigInt(raw.amountPaise)) / 100;
  }
  return raw.amountRupees;
}

/** Server-side reduction of a raw transfer row to the client-safe shape. */
export function toClientTransferRow(raw: RawTransferRow): TransferRow {
  // A server-masked value (e.g. "••••1234" or "XXXXXXXX1234") already shows
  // only its tail: take its last 4 digits directly. A raw account number
  // needs more than 4 characters, otherwise there is nothing safe to show.
  const maskedDigits = (raw.accountNumberMasked ?? "").replace(/[^0-9]/g, "");
  const rawSource = (raw.accountNumber ?? "").replace(/[^0-9A-Za-z]/g, "");
  const accountLast4 = maskedDigits.length >= 4
    ? maskedDigits.slice(-4)
    : rawSource.length > 4 ? rawSource.slice(-4) : null;
  return {
    id: raw.id,
    employeeName: raw.employeeName,
    accountLast4,
    ifsc: raw.ifsc,
    amountRupees: rupeesOf(raw),
    status: raw.status,
    nachBatchId: raw.nachBatchId,
    failureReason: raw.failureReason,
  };
}
