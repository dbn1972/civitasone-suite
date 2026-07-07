/**
 * Data Migration Script: Batch-encrypt plaintext PII rows
 *
 * Purpose: Encrypts existing plaintext PII fields (pan, email, phone, bank_account, ifsc)
 *          in vendor.procurement_vendors using AES-256-GCM via the pii-crypto module.
 *          Processes 1000 rows per transaction and sets pii_encrypted_at on each batch.
 *
 * Prerequisites:
 *   - Migration 0014 applied (pii_encrypted_at column exists)
 *   - PII_ENC_KEY env var set (>=16 chars)
 *   - DATABASE_URL env var set
 *
 * Usage:
 *   PII_ENC_KEY=your-secret-key DATABASE_URL=postgres://... npx tsx scripts/migrate-encrypt-pii.ts
 *
 * Rollback:
 *   Not directly reversible — encrypted data cannot be "unencrypted" without running
 *   a reverse script with the same key. The pii_encrypted_at column can be reset to NULL
 *   if needed: UPDATE vendor.procurement_vendors SET pii_encrypted_at = NULL;
 *
 * Affected services: procurement-service
 * Requirements: 2.2
 */

import postgres from "postgres";
import { encryptPii, isEncrypted } from "../src/shared/pii-crypto.js";

const BATCH_SIZE = 1000;
const PII_COLUMNS = ["pan", "email", "phone", "bank_account", "ifsc"] as const;

interface VendorPiiRow {
  id: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  bank_account: string | null;
  ifsc: string | null;
}

async function main(): Promise<void> {
  // Validate required env vars
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate-encrypt-pii] ERROR: DATABASE_URL is required");
    process.exit(1);
  }

  const piiKey = process.env.PII_ENC_KEY;
  if (!piiKey || piiKey.length < 16) {
    console.error("[migrate-encrypt-pii] ERROR: PII_ENC_KEY is required (>=16 chars)");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  let totalProcessed = 0;
  let batchNumber = 0;

  console.log("[migrate-encrypt-pii] Starting PII encryption migration...");
  console.log(`[migrate-encrypt-pii] Batch size: ${BATCH_SIZE}`);

  try {
    // Process in batches until no more unencrypted rows remain
    while (true) {
      batchNumber++;

      const rows = await sql<VendorPiiRow[]>`
        SELECT id, pan, email, phone, bank_account, ifsc
        FROM vendor.procurement_vendors
        WHERE pii_encrypted_at IS NULL
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      `;

      if (rows.length === 0) {
        console.log("[migrate-encrypt-pii] No more unencrypted rows found.");
        break;
      }

      console.log(`[migrate-encrypt-pii] Batch ${batchNumber}: processing ${rows.length} rows...`);

      // Process the entire batch in a single transaction
      await sql.begin(async (tx) => {
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
                pan = COALESCE(${updates.pan ?? null}, pan),
                email = COALESCE(${updates.email ?? null}, email),
                phone = COALESCE(${updates.phone ?? null}, phone),
                bank_account = COALESCE(${updates.bank_account ?? null}, bank_account),
                ifsc = COALESCE(${updates.ifsc ?? null}, ifsc),
                pii_encrypted_at = now(),
                updated_at = now()
              WHERE id = ${row.id}
            `;
          } else {
            // Row has all PII already encrypted or null — just mark it processed
            await tx`
              UPDATE vendor.procurement_vendors
              SET pii_encrypted_at = now(), updated_at = now()
              WHERE id = ${row.id}
            `;
          }
        }
      });

      totalProcessed += rows.length;
      console.log(`[migrate-encrypt-pii] Batch ${batchNumber} committed. Total processed: ${totalProcessed}`);
    }

    console.log(`[migrate-encrypt-pii] Migration complete. Total rows processed: ${totalProcessed}`);
  } catch (error) {
    console.error("[migrate-encrypt-pii] ERROR: Migration failed", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
