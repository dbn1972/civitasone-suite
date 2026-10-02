/**
 * DSC Loader — fetches the signing certificate material for a given tenant.
 *
 * Priority:
 * 1. Tenant-specific (from dsc_config table + S3)
 * 2. Global (DSC_P12_PATH + DSC_PASSPHRASE env vars)
 * 3. null (no DSC available → unsigned mode)
 *
 * S3 fetch uses @civitasone/circuit-breaker for resilience.
 * Emits payroll.dsc.expiry_warning if certificate expires within 30 days.
 */
import { readFile } from "node:fs/promises";
import { CircuitBreaker } from "@civitasone/circuit-breaker";
import { getObject } from "@civitasone/storage";
import { validateDscCertificate, type CertificateInfo } from "@civitasone/render";
import { queue } from "../../shared/infra.js";
import { pino } from "pino";
import * as repo from "./repo.js";
import { isSealed, isSealedP12, openDscPassphrase, openP12 } from "./secret.js";

const log = pino({ name: "payroll-dsc-loader" });

const EXPIRY_WARNING_DAYS = 30;
const DSC_EXPIRY_TOPIC = "payroll.dsc.expiry_warning";

export interface DscMaterial {
  p12Buffer: Buffer;
  passphrase: string;
  certInfo: CertificateInfo;
}

const s3Breaker = new CircuitBreaker({
  name: "dsc-s3-fetch",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

/**
 * Load DSC material for a tenant.
 * Returns null if no DSC is configured (unsigned mode).
 */
export async function loadDsc(tenantId: string): Promise<DscMaterial | null> {
  // 1. Tenant-specific: check DB for config row
  const row = await repo.findByTenantId(tenantId);

  if (row) {
    // Fetch (sealed) P12 from S3 with circuit breaker
    const blob = await s3Breaker.call(() => getObject(row.storageRef));

    // Rollout visibility only — never the value itself. Once the backfill
    // reports remainingUnsealed: 0, set DSC_ALLOW_LEGACY_UNSEALED=false so a
    // plaintext secret is refused instead of used.
    if (!isSealed(row.passphraseSealed) || !isSealedP12(blob)) {
      if (process.env.DSC_ALLOW_LEGACY_UNSEALED === "false") {
        throw new Error(
          "legacy unsealed DSC secret refused (DSC_ALLOW_LEGACY_UNSEALED=false); run scripts/backfill-dsc-secrets.mjs or re-upload the DSC",
        );
      }
      log.warn(
        { tenantId, passphraseSealed: isSealed(row.passphraseSealed), p12Sealed: isSealedP12(blob) },
        "legacy unsealed DSC secret in use; run scripts/backfill-dsc-secrets.mjs",
      );
    }

    // Decrypt only now, at the moment of use (signing). Throws
    // PiiDecryptError (no secret in the message) on a missing/wrong key.
    const p12Buffer = openP12(blob);
    const passphrase = openDscPassphrase(row.passphraseSealed);

    // Validate certificate
    const certInfo = validateDscCertificate(p12Buffer, passphrase);

    // Emit expiry warning if < 30 days remaining
    await emitExpiryWarningIfNeeded(tenantId, certInfo);

    return { p12Buffer, passphrase, certInfo };
  }

  // 2. Global env var fallback
  const globalP12Path = process.env.DSC_P12_PATH;
  const globalPassphrase = process.env.DSC_PASSPHRASE;

  if (globalP12Path && globalPassphrase) {
    const p12Buffer = await readFile(globalP12Path);
    const certInfo = validateDscCertificate(p12Buffer, globalPassphrase);

    await emitExpiryWarningIfNeeded(tenantId, certInfo);

    return { p12Buffer, passphrase: globalPassphrase, certInfo };
  }

  // 3. No DSC → unsigned mode
  return null;
}

async function emitExpiryWarningIfNeeded(tenantId: string, certInfo: CertificateInfo): Promise<void> {
  const now = new Date();
  const daysRemaining = Math.floor((certInfo.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysRemaining <= EXPIRY_WARNING_DAYS && daysRemaining > 0) {
    await queue.publish(DSC_EXPIRY_TOPIC, {
      type: DSC_EXPIRY_TOPIC,
      tenantId,
      actorId: "system",
      correlationId: `dsc-expiry-${tenantId}`,
      schemaVersion: "1.0",
      payload: {
        tenantId,
        expiresAt: certInfo.notAfter.toISOString(),
        daysRemaining,
        subjectCN: certInfo.subjectCN,
      },
    });
  }
}
