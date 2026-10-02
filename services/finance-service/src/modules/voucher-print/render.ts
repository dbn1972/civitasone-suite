/** Pure rendering helpers for the voucher print routes. Money stays bigint paise. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Paise (bigint) -> "1,23,456.78" with Indian grouping, no float maths. */
export function fmtMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = (abs / 100n).toLocaleString("en-IN");
  return `${negative ? "-" : ""}${rupees}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export interface VoucherLine {
  accountCode: string;
  debitMinor: bigint | number | string;
  creditMinor: bigint | number | string;
}

/** Table rows plus debit/credit totals, summed as bigint. */
export function buildVoucherLines(lines: readonly VoucherLine[]): { lineRows: string; totalDebit: string; totalCredit: string } {
  let dr = 0n;
  let cr = 0n;
  const lineRows = lines
    .map((l) => {
      const d = BigInt(l.debitMinor);
      const c = BigInt(l.creditMinor);
      dr += d;
      cr += c;
      return `<tr><td>${escHtml(l.accountCode)}</td><td class="amount">${fmtMinor(d)}</td><td class="amount">${fmtMinor(c)}</td><td></td></tr>`;
    })
    .join("");
  return { lineRows, totalDebit: fmtMinor(dr), totalCredit: fmtMinor(cr) };
}
