/**
 * M9: the bank's success file for a run paid without a NACH return (NEFT / CSV
 * upload), as a simple CSV:
 *
 *     employee_no,amount,utr,status
 *     EMP-0001,42000.00,SBIN26111100001,SUCCESS
 *
 * The header row is optional (columns are then positional) and may reorder the
 * columns by name. The amount (rupees, at most 2 decimals) and the utr are
 * optional; status defaults to success and may be success / credited / paid /
 * processed, or failed / returned / rejected / reversed. Pure: parsing only.
 */
import { createHash } from "node:crypto";

export type BankConfirmationRecord = {
  employeeNo: string;
  /** Paise, or null when the file carries no amount. */
  amountMinor: bigint | null;
  utr: string | null;
  outcome: "success" | "failed";
};

export type BankConfirmationParse = { records: BankConfirmationRecord[]; errors: Array<{ line: number; message: string }> };

export const MAX_BANK_CONFIRMATION_ROWS = 20_000;

type Col = "employeeNo" | "amount" | "utr" | "status";
const HEADER_ALIASES: Record<string, Col> = {
  employee_no: "employeeNo", employeeno: "employeeNo", employee_code: "employeeNo", emp_no: "employeeNo", empno: "employeeNo", employee_number: "employeeNo",
  amount: "amount", net_pay: "amount", net_amount: "amount", netpay: "amount",
  utr: "utr", utr_no: "utr", reference: "utr", txn_ref: "utr", transaction_ref: "utr", bank_reference: "utr",
  status: "status", result: "status", outcome: "status",
};
const SUCCESS = new Set(["", "success", "successful", "credited", "paid", "processed", "completed", "ok"]);
const FAILED = new Set(["failed", "failure", "returned", "rejected", "reversed", "unpaid"]);

/** Split one CSV line honouring double-quoted cells. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "42,000.50" / "42000" to paise; null when not a plain rupee amount with at most 2 decimals. */
export function parseRupeesToMinor(raw: string): bigint | null {
  const s = raw.replace(/,/g, "").replace(/^(?:INR|Rs\.?|₹)\s*/i, "").trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

export function parseBankConfirmation(content: string): BankConfirmationParse {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  const records: BankConfirmationRecord[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  let cols: Array<Col | undefined> = ["employeeNo", "amount", "utr", "status"];
  let first = true;
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]!;
    if (raw.trim() === "") continue;
    const cells = splitCsvLine(raw);
    const lineNo = idx + 1;
    if (first) {
      first = false;
      const mapped = cells.map((c) => HEADER_ALIASES[c.toLowerCase().replace(/[\s-]+/g, "_")]);
      if (mapped.includes("employeeNo")) { cols = mapped; continue; }
    }
    if (records.length >= MAX_BANK_CONFIRMATION_ROWS) { errors.push({ line: lineNo, message: `more than ${MAX_BANK_CONFIRMATION_ROWS} rows` }); break; }
    const get = (k: Col): string => { const i = cols.indexOf(k); return i >= 0 ? (cells[i] ?? "") : ""; };
    const employeeNo = get("employeeNo");
    if (!employeeNo) { errors.push({ line: lineNo, message: "employee_no is empty" }); continue; }
    const amountRaw = get("amount");
    const amountMinor = amountRaw === "" ? null : parseRupeesToMinor(amountRaw);
    if (amountRaw !== "" && amountMinor === null) { errors.push({ line: lineNo, message: `amount "${amountRaw.slice(0, 30)}" is not a rupee amount` }); continue; }
    const status = get("status").toLowerCase();
    const outcome = SUCCESS.has(status) ? "success" : FAILED.has(status) ? "failed" : null;
    if (outcome === null) { errors.push({ line: lineNo, message: `status "${status.slice(0, 30)}" is not recognised` }); continue; }
    records.push({ employeeNo, amountMinor, utr: get("utr") || null, outcome });
  }
  return { records, errors };
}

/** sha256 of the content with line endings and trailing whitespace normalised (the NACH return rule). */
export function bankConfirmationHash(content: string): string {
  const norm = content.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
  return createHash("sha256").update(norm).digest("hex");
}
