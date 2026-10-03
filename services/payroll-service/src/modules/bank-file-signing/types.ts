/**
 * GAP-PAYROLL-DISBURSEMENT-03 -- bank-file signing: shared types, the
 * per-tenant `bankFileSigning` setting and its validation.
 *
 * DEFAULTS (signing is ON unless a tenant explicitly changes it):
 *   - Bank host-to-host / NEFT / RTGS / NACH files (csv / txt / fixed-width):
 *     `pgp_detached` -- an OpenPGP detached signature (ASCII-armoured,
 *     SHA-256) over the exact file bytes. Corporate H2H channels of Indian
 *     banks commonly use PGP.
 *   - PFMS-style XML payment files: `xml_dsig` -- XML-DSig enveloped signature
 *     (RSA-SHA256, exclusive C14N). Payroll does not generate PFMS XML today,
 *     so no payroll file can use it yet; the signer is built, tested and
 *     fails closed (SIGNING_FORMAT_NOT_APPLICABLE) if pointed at a non-XML file.
 *   - `pkcs7_detached` (.p7s) for banks that want CMS/PKCS#7.
 *   - `none` only in dev/sandbox; refused when NODE_ENV=production or the
 *     tenant's integration environment is production.
 *
 * Encrypt-to-bank (OpenPGP to the bank's public key) is OFF by default.
 *
 * `keyRef` is an OPAQUE STRING resolved by a SigningKeyProvider
 * (key-provider.ts) -- it never contains key material, so a tenant
 * integration config (bank_api provider) can carry the same string later.
 */
import { z } from "zod";

export const SIGNING_FORMATS = ["pgp_detached", "xml_dsig", "pkcs7_detached", "none"] as const;
export type SigningFormat = (typeof SIGNING_FORMATS)[number];

/** A bank code is the 4-letter IFSC prefix / sponsor code (e.g. SBIN, HDFC). */
export const BANK_CODE_RE = /^[A-Z]{4}$/;
/**
 * Plain-string key reference. ':' and '/' allowed for namespacing (e.g.
 * "hsm:slot1", "kms/payroll"), but it must start alphanumeric and never
 * contain ".." -- it is a name, not a path.
 */
export const KEY_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const isValidKeyRef = (s: string): boolean => KEY_REF_RE.test(s) && !s.includes("..");
export const DEFAULT_KEY_REF = "default";

export interface BankFileSigningConfig {
  format: SigningFormat;
  perBankOverrides?: Record<string, SigningFormat> | undefined;
  encryptToBank: boolean;
  keyRef: string;
}

export const DEFAULT_BANK_FILE_SIGNING: BankFileSigningConfig = {
  format: "pgp_detached",
  encryptToBank: false,
  keyRef: DEFAULT_KEY_REF,
};

export const bankFileSigningConfigSchema = z.object({
  format: z.enum(SIGNING_FORMATS),
  perBankOverrides: z.record(z.string().regex(BANK_CODE_RE, "bank code must be 4 capital letters"), z.enum(SIGNING_FORMATS)).optional(),
  encryptToBank: z.boolean(),
  keyRef: z.string().refine(isValidKeyRef, "keyRef must be 1-128 characters, start with a letter or digit, and use only letters, digits and . _ : / - (no '..')"),
});

/** Format that applies to a file for `bankCode` (override, else the tenant default). */
export function effectiveFormat(cfg: BankFileSigningConfig, bankCode: string | null): SigningFormat {
  if (bankCode && cfg.perBankOverrides) {
    const o = cfg.perBankOverrides[bankCode.toUpperCase()];
    if (o) return o;
  }
  return cfg.format;
}

/** Every format the config can ever select (default + overrides). */
export function configuredFormats(cfg: BankFileSigningConfig): SigningFormat[] {
  return [cfg.format, ...Object.values(cfg.perBankOverrides ?? {})];
}

/** Signature file extension of a detached format (null = no sidecar). */
export function signatureExtension(format: SigningFormat): "sig" | "p7s" | null {
  return format === "pgp_detached" ? "sig" : format === "pkcs7_detached" ? "p7s" : null;
}

export function signatureContentType(format: SigningFormat): string | null {
  return format === "pgp_detached" ? "application/pgp-signature" : format === "pkcs7_detached" ? "application/pkcs7-signature" : null;
}
