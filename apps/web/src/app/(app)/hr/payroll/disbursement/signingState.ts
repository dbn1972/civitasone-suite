/**
 * Types and pure helpers for bank-file signing on /hr/payroll/disbursement
 * (GAP-PAYROLL-DISBURSEMENT-03). Deliberately NOT a "use client" module:
 * page.tsx (a Server Component) calls these on the server.
 *
 * Mirrors payroll-service bank-file-signing/types.ts. The server is the
 * authority; this module only shapes what it sent.
 */
export const SIGNING_FORMATS = ["pgp_detached", "xml_dsig", "pkcs7_detached", "none"] as const;
export type SigningFormat = (typeof SIGNING_FORMATS)[number];

export type SigningConfig = {
  format: SigningFormat;
  perBankOverrides: Record<string, SigningFormat>;
  encryptToBank: boolean;
  keyRef: string;
};

export type KeyStatus = { provider: string; present: boolean; fingerprint: string | null; detail: string | null };

export type SigningSettings = {
  config: SigningConfig;
  isDefault: boolean;
  /** NODE_ENV=production or the tenant's integration environment is production: `none` is refused. */
  unsignedAllowed: boolean;
  key: KeyStatus;
};

/** One issued bank file (GET /v1/payroll/disbursement/files). */
export type IssuedFile = {
  id: string;
  runNo: string | null;
  month: string | null;
  seq: number;
  fileFormat: string;
  fileName: string;
  lineCount: number;
  createdAt: string;
  signatureFormat: SigningFormat;
  signed: boolean;
  hasDetachedSignature: boolean;
  fileSha256: string | null;
  encryptedToBank: boolean;
};

const BANK_CODE_RE = /^[A-Z]{4}$/;
const KEY_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export const isValidBankCode = (s: string): boolean => BANK_CODE_RE.test(s);
export const isValidKeyRef = (s: string): boolean => KEY_REF_RE.test(s) && !s.includes("..");
const isFormat = (v: unknown): v is SigningFormat => typeof v === "string" && (SIGNING_FORMATS as readonly string[]).includes(v);

/** true when the list has at least one entry (kept out of page.tsx: empty-vs-error guard). */
export const hasItems = <T,>(list: readonly T[]): boolean => list.length > 0;

export type OverrideRow = { rowId: number; bank: string; format: SigningFormat };

export function toOverrideRows(map: Record<string, SigningFormat>): OverrideRow[] {
  return Object.entries(map).map(([bank, format], i) => ({ rowId: i + 1, bank, format }));
}

export type OverrideResult =
  | { ok: true; value: Record<string, SigningFormat> }
  | { ok: false; error: "bankCode" | "duplicate" };

/** Validates the editor rows and folds them into the API's { bankCode: format } map. */
export function overridesFromRows(rows: readonly OverrideRow[]): OverrideResult {
  const out: Record<string, SigningFormat> = {};
  for (const r of rows) {
    const bank = r.bank.trim().toUpperCase();
    if (!isValidBankCode(bank)) return { ok: false, error: "bankCode" };
    if (bank in out) return { ok: false, error: "duplicate" };
    out[bank] = r.format;
  }
  return { ok: true, value: out };
}

/** True when `none` is selected anywhere (default or a per-bank override). */
export const usesUnsigned = (format: SigningFormat, rows: readonly OverrideRow[]): boolean =>
  format === "none" || rows.some((r) => r.format === "none");

export type SignedBadgeKind = "pgp" | "xml" | "pkcs7" | "unsigned";

/** Badge to show for a file: only an explicit signed state with a known format counts as signed. */
export function signedBadgeKind(format: string | null | undefined, signed: boolean): SignedBadgeKind {
  if (!signed) return "unsigned";
  if (format === "pgp_detached") return "pgp";
  if (format === "xml_dsig") return "xml";
  if (format === "pkcs7_detached") return "pkcs7";
  return "unsigned";
}

/** GET /v1/payroll/bank-file-signing -> SigningSettings (null on an unusable payload). */
export function mapSigningSettings(p: unknown): SigningSettings | null {
  if (typeof p !== "object" || p === null) return null;
  const o = p as Record<string, unknown>;
  const c = o.config as Record<string, unknown> | undefined;
  const k = o.key as Record<string, unknown> | undefined;
  if (!c || !k || !isFormat(c.format) || typeof c.encryptToBank !== "boolean" || typeof c.keyRef !== "string") return null;
  const overrides: Record<string, SigningFormat> = {};
  for (const [bank, f] of Object.entries((c.perBankOverrides as Record<string, unknown> | undefined) ?? {})) {
    if (isFormat(f)) overrides[bank] = f;
  }
  return {
    config: { format: c.format, perBankOverrides: overrides, encryptToBank: c.encryptToBank, keyRef: c.keyRef },
    isDefault: o.isDefault === true,
    unsignedAllowed: o.unsignedAllowed === true,
    key: {
      provider: typeof k.provider === "string" ? k.provider : "",
      present: k.present === true,
      fingerprint: typeof k.fingerprint === "string" ? k.fingerprint : null,
      detail: typeof k.detail === "string" ? k.detail : null,
    },
  };
}

/** GET /v1/payroll/disbursement/files -> rows (null when the payload is not the expected envelope). */
export function mapIssuedFiles(p: unknown): IssuedFile[] | null {
  const arr = Array.isArray(p) ? p : (p as { data?: unknown } | null)?.data;
  if (!Array.isArray(arr)) return null;
  const out: IssuedFile[] = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.id !== "string" || typeof r.fileName !== "string") continue;
    out.push({
      id: r.id,
      runNo: typeof r.runNo === "string" ? r.runNo : null,
      month: typeof r.month === "string" ? r.month : null,
      seq: Number(r.seq ?? 0),
      fileFormat: String(r.fileFormat ?? ""),
      fileName: r.fileName,
      lineCount: Number(r.lineCount ?? 0),
      createdAt: String(r.createdAt ?? ""),
      signatureFormat: isFormat(r.signatureFormat) ? r.signatureFormat : "none",
      signed: r.signed === true,
      hasDetachedSignature: r.hasDetachedSignature === true,
      fileSha256: typeof r.fileSha256 === "string" ? r.fileSha256 : null,
      encryptedToBank: r.encryptedToBank === true,
    });
  }
  return out;
}
