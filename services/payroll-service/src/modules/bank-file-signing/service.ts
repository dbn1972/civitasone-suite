/**
 * Bank-file signing orchestration: plan (which format, may it be unsigned?),
 * sign, SELF-CHECK, optionally encrypt to the bank. Fails closed: any problem
 * aborts the issuance (the caller's transaction rolls back, so no ledger rows
 * and no file exist for an unsigned/unverifiable result).
 */
import { createHash } from "node:crypto";
import { HttpError } from "../../shared/context.js";
import type { RenderedFile } from "../bank-transfer/issuance.js";
import { isProductionFor } from "./environment.js";
import { getSigningKeyProvider, SigningKeyError, type SigningKeyProvider, type SigningMaterial } from "./key-provider.js";
import {
  encryptPgpToRecipient, pgpPublicKeyOf, signPgpDetached, signPkcs7Detached, signXmlDsig,
  verifyPgpDetached, verifyPkcs7Detached, verifyXmlDsig,
} from "./signers.js";
import {
  configuredFormats, effectiveFormat, signatureContentType, signatureExtension,
  type BankFileSigningConfig, type SigningFormat,
} from "./types.js";

export interface SigningPlan {
  format: SigningFormat;
  encryptToBank: boolean;
  keyRef: string;
  bankCode: string | null;
}

/** What is recorded on the issuance row (migration 0074) and returned to the caller. */
export interface SigningRecord {
  format: SigningFormat;
  /** true for any format except "none". */
  signed: boolean;
  /** Detached signature: armoured (pgp) / base64 DER (pkcs7); null for xml_dsig and none. */
  signature: string | null;
  signatureFileName: string | null;
  signatureContentType: string | null;
  fileSha256: string;
  signedAt: Date | null;
  keyFingerprint: string | null;
  encryptedToBank: boolean;
}

export interface SignedFile {
  /** The file to hand back (body may be the XML-signed or the encrypted bytes). */
  file: RenderedFile;
  record: SigningRecord;
}

/**
 * `none` (unsigned) is refused when NODE_ENV=production or the tenant's
 * integration environment is production -- both for the tenant default and
 * for any per-bank override.
 */
export async function assertUnsignedAllowed(tenantId: string, cfg: BankFileSigningConfig): Promise<void> {
  if (!configuredFormats(cfg).includes("none")) return;
  if (await isProductionFor(tenantId)) {
    throw new HttpError(422, "UNSIGNED_NOT_ALLOWED_IN_PRODUCTION",
      "unsigned bank files are not allowed in production; choose pgp_detached, xml_dsig or pkcs7_detached");
  }
}

export async function planBankFileSigning(tenantId: string, cfg: BankFileSigningConfig, bankCode: string | null): Promise<SigningPlan> {
  const format = effectiveFormat(cfg, bankCode);
  if (format === "none") await assertUnsignedAllowed(tenantId, { ...cfg, format: "none" });
  if (format === "none" && cfg.encryptToBank) {
    throw new HttpError(422, "SIGNING_CONFIG_CONFLICT", "encrypt-to-bank requires a signed format");
  }
  return { format, encryptToBank: cfg.encryptToBank, keyRef: cfg.keyRef, bankCode: bankCode ? bankCode.toUpperCase() : null };
}

const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function selfCheckFailed(): never {
  throw new HttpError(500, "SIGNING_SELF_CHECK_FAILED", "the bank file signature failed verification right after signing; the file was not issued");
}

function keyUnavailable(err: unknown): never {
  if (err instanceof SigningKeyError) {
    const status = err.code === "RECIPIENT_KEY_MISSING" ? 422 : 503;
    throw new HttpError(status, `SIGNING_${err.code}`, err.message);
  }
  throw err;
}

/**
 * Sign (and optionally encrypt) a rendered file. Verifies the signature before
 * returning; a failed verification throws SIGNING_SELF_CHECK_FAILED.
 */
export async function signRenderedFile(plan: SigningPlan, file: RenderedFile, provider: SigningKeyProvider = getSigningKeyProvider()): Promise<SignedFile> {
  const original = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, "utf8");

  if (plan.format === "none") {
    return {
      file,
      record: {
        format: "none", signed: false, signature: null, signatureFileName: null, signatureContentType: null,
        fileSha256: sha256Hex(original), signedAt: null, keyFingerprint: null, encryptedToBank: false,
      },
    };
  }

  let material: SigningMaterial;
  try {
    material = await provider.getSigningMaterial(plan.keyRef);
  } catch (err) {
    return keyUnavailable(err);
  }

  let signedBytes: Buffer = original;
  let signature: string | null = null;
  let fingerprint: string;
  try {
    if (plan.format === "pgp_detached") {
      signature = await signPgpDetached(original, material.pgpPrivateKeyArmored);
      const check = await verifyPgpDetached(original, signature, await pgpPublicKeyOf(material.pgpPrivateKeyArmored));
      if (!check.ok || check.hash !== "sha256") selfCheckFailed();
      fingerprint = material.pgpFingerprint;
    } else if (plan.format === "pkcs7_detached") {
      const der = signPkcs7Detached(original, material.rsaPrivateKeyPem, material.certPem);
      if (!verifyPkcs7Detached(original, der, material.certPem)) selfCheckFailed();
      signature = der.toString("base64");
      fingerprint = material.certFingerprint;
    } else {
      // xml_dsig: only an XML file can carry an enveloped signature.
      if (!/xml/i.test(file.contentType)) {
        throw new HttpError(422, "SIGNING_FORMAT_NOT_APPLICABLE",
          `xml_dsig applies only to XML payment files, but this ${file.contentType.split(";")[0]} file is not XML; use pgp_detached or pkcs7_detached (or set a per-bank override)`);
      }
      const signedXml = signXmlDsig(original.toString("utf8"), material.rsaPrivateKeyPem, material.certPem);
      if (!verifyXmlDsig(signedXml, material.certPem)) selfCheckFailed();
      signedBytes = Buffer.from(signedXml, "utf8");
      fingerprint = material.certFingerprint;
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, "SIGNING_FAILED", "the bank file could not be signed; the file was not issued");
  }

  const fileSha256 = sha256Hex(signedBytes);
  let delivered: RenderedFile = { ...file, body: signedBytes };
  if (plan.encryptToBank) {
    try {
      const recipient = await provider.getRecipientPublicKey(plan.keyRef, plan.bankCode);
      delivered = {
        ...delivered,
        body: await encryptPgpToRecipient(signedBytes, recipient),
        contentType: "application/octet-stream",
        downloadName: `${file.downloadName}.pgp`,
      };
    } catch (err) {
      if (err instanceof SigningKeyError) return keyUnavailable(err);
      throw new HttpError(500, "SIGNING_ENCRYPT_FAILED", "the bank file could not be encrypted to the bank key; the file was not issued");
    }
  }

  const ext = signatureExtension(plan.format);
  return {
    file: delivered,
    record: {
      format: plan.format,
      signed: true,
      signature,
      signatureFileName: ext && signature ? `${file.downloadName}.${ext}` : null,
      signatureContentType: signatureContentType(plan.format),
      fileSha256,
      signedAt: new Date(),
      keyFingerprint: fingerprint,
      encryptedToBank: plan.encryptToBank,
    },
  };
}
