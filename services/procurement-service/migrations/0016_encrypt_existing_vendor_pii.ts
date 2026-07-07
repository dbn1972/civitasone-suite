/**
 * 0016_encrypt_existing_vendor_pii.ts
 *
 * Data migration: Batch-encrypt existing plaintext PII columns in vendor.procurement_vendors.
 *
 * Purpose: Rows where pii_encrypted_at IS NULL may contain plaintext PII values.
 *          This script encrypts them in batches of 1000 rows per transaction,
 *          setting pii_encrypted_at = NOW() on each processed row.
 *
 * Rollback: This is a one-way data migration. Rollback requires restoring from backup.
 *           The decryptPii() function handles both plaintext and ciphertext gracefully
 *           via the isEncrypted() check, so partial runs are safe to re-execute.
 *
 * Affected services: procurement-service
 * Requirements: 2.2
 *
 * Usage:
 *   DATABASE_URL=postgres://... PII_ENC_KEY=... tsx migrations/0016_encrypt_existing_vendor_pii.ts
 */

import postgres from "postgres";
import { encryptPii, isEncrypted } from "../src/shared/pii-crypto.js";

const BATCH_SIZE = 1000;
const LOCK_TIMEOUT = "5s";

const PII_COLUMNS = ["pan", "email", "phone", "bank_account", "ifsc"] as const;

interface VendorPiiRow {
  id: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  bank_account: string | null;
  ifsc: string | null;
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

  log("Starting PII encryption data migration", {
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
        const rows = await tx<VendorPiiRow[]>`
          SELECT id, pan, email, phone, bank_account, ifsc
          FROM vendor.procurement_vendors
          WHERE pii_encrypted_at IS NULL
          ORDER BY id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) {
          return 0;
        }

        // Process each row in the batch
        for (const row of rows) {
          const updates: Record<string, string | null> = {};
          let hasUpdate = false;

          for (const col of PII_COLUMNS) {
            const value = row[col];
            if (value !== null && !isEncrypted(value)) {
              updates[col] = encryptPii(value);
              hasUpdate = true;
            }
          }

          if (hasUpdate) {
            await tx`
              UPDATE vendor.procurement_vendors
              SET
                pan = COALESCE(${updates.pan ?? null}::text, pan),
                email = COALESCE(${updates.email ?? null}::text, email),
                phone = COALESCE(${updates.phone ?? null}::text, phone),
                bank_account = COALESCE(${updates.bank_account ?? null}::text, bank_account),
                ifsc = COALESCE(${updates.ifsc ?? null}::text, ifsc),
                pii_encrypted_at = NOW()
              WHERE id = ${row.id}
            `;
          } else {
            // All PII fields are either null or already encrypted — just mark as processed
            await tx`
              UPDATE vendor.procurement_vendors
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
      log("PII encryption migration completed", {
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
    msg: "PII encryption migration failed",
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
  process.exit(1);
});
