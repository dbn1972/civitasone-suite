/**
 * 0021_encrypt_existing_contractor_pan.ts
 *
 * SEC-011 data migration: Batch-encrypt existing plaintext `pan` values in
 * works.contractors.
 *
 * Purpose: Rows where pii_encrypted_at IS NULL may contain a plaintext PAN.
 *          This script encrypts them in batches of 1000 rows per transaction,
 *          setting pii_encrypted_at = NOW() on each processed row.
 *
 * Rollback: This is a one-way data migration. Rollback requires restoring from
 *           backup. decryptPii() handles both plaintext and ciphertext
 *           gracefully via the isEncrypted() check, so partial runs are safe
 *           to re-execute.
 *
 * Affected services: works-service
 * Mirrors: procurement-service/migrations/0016_encrypt_existing_vendor_pii.ts
 *
 * OPERATIONAL NOTE (SEC-011 backfill caveat): this script is NOT run
 * automatically by CI or by the migration bootstrap — it must be run once,
 * by hand, against each live environment after this PR deploys. Until it is
 * run, pre-existing contractor rows keep their plaintext `pan` value (new
 * writes are encrypted immediately via the `encryptedText` column type
 * regardless of whether this backfill has run). See SEC-011 in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md for tracking.
 *
 * Usage:
 *   DATABASE_URL=postgres://... PII_ENC_KEY=... tsx migrations/0021_encrypt_existing_contractor_pan.ts
 */

import postgres from "postgres";
import { encryptPii, isEncrypted } from "../src/shared/pii-crypto.js";

const BATCH_SIZE = 1000;
const LOCK_TIMEOUT = "5s";

interface ContractorPanRow {
  id: string;
  pan: string | null;
}

function log(message: string, meta?: Record<string, unknown>): void {
  const entry = {
    level: "info",
    ts: new Date().toISOString(),
    msg: message,
    ...meta,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

function logWarn(message: string, meta?: Record<string, unknown>): void {
  const entry = {
    level: "warn",
    ts: new Date().toISOString(),
    msg: message,
    ...meta,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  // Validate PII_ENC_KEY is available (encryptPii will throw if missing)
  if (!process.env.PII_ENC_KEY || process.env.PII_ENC_KEY.length < 16) {
    throw new Error("PII_ENC_KEY is required (>=16 chars) for encryption");
  }

  const sql = postgres(url, { max: 2 });
  const startTime = Date.now();
  let totalProcessed = 0;
  let batchNumber = 0;

  log("Starting contractor PAN encryption data migration", {
    batchSize: BATCH_SIZE,
    lockTimeout: LOCK_TIMEOUT,
  });

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      batchNumber++;
      const batchStart = Date.now();

      const rowsEncrypted = await sql.begin(async (tx) => {
        // Set lock timeout to avoid blocking production queries
        await tx`SET LOCAL lock_timeout = ${LOCK_TIMEOUT}`;

        // Fetch a batch of unencrypted rows
        const rows = await tx<ContractorPanRow[]>`
          SELECT id, pan
          FROM works.contractors
          WHERE pii_encrypted_at IS NULL
          ORDER BY id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) {
          return 0;
        }

        for (const row of rows) {
          if (row.pan !== null && !isEncrypted(row.pan)) {
            const encrypted = encryptPii(row.pan);
            await tx`
              UPDATE works.contractors
              SET pan = ${encrypted}, pii_encrypted_at = NOW()
              WHERE id = ${row.id}
            `;
          } else {
            // pan is null or already encrypted — just mark as processed
            await tx`
              UPDATE works.contractors
              SET pii_encrypted_at = NOW()
              WHERE id = ${row.id}
            `;
          }
        }

        return rows.length;
      });

      if (rowsEncrypted === 0) {
        break;
      }

      totalProcessed += rowsEncrypted;
      const batchElapsed = Date.now() - batchStart;

      log("Batch processed", {
        batch: batchNumber,
        rowsInBatch: rowsEncrypted,
        totalProcessed,
        batchDurationMs: batchElapsed,
      });
    }

    const totalElapsed = Date.now() - startTime;

    if (totalProcessed === 0) {
      logWarn("No unencrypted rows found — migration already complete or table is empty");
    } else {
      log("Contractor PAN encryption migration completed", {
        totalBatches: batchNumber - 1,
        totalRowsProcessed: totalProcessed,
        totalDurationMs: totalElapsed,
      });
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  const entry = {
    level: "error",
    ts: new Date().toISOString(),
    msg: "Contractor PAN encryption migration failed",
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
  process.exit(1);
});
