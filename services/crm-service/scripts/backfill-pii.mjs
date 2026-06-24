#!/usr/bin/env node
/**
 * crm-service: backfill PII encryption (P0-2 / DPDP).
 *
 * Migration 0005 widened contacts.email/phone to text and added email_idx but
 * could NOT encrypt existing rows (the AES/HMAC keys are app-held, not in SQL).
 * This script encrypts any legacy PLAINTEXT email/phone in-place and populates
 * the blind index (email_idx) so the unique constraint + de-dup keep working.
 *
 * Uses the SAME pii-crypto module as the service (dist build) so wire format,
 * key derivation and blind index are byte-identical. Idempotent: rows already
 * enc:v2 are skipped (isEncrypted guard); re-running is a no-op.
 *
 * Requires env: DATABASE_URL, CRM_PII_KEY (+ optional CRM_PII_SALT / KEY_ID /
 * KEYRING) — same as the running service. Run from the service dir AFTER build:
 *   node scripts/backfill-pii.mjs
 */
import postgres from "postgres";
import { encryptPii, isEncrypted, blindIndex } from "../dist/shared/pii-crypto.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
// Fail fast if the key is missing (pii-crypto would throw on first use anyway).
if (!process.env.CRM_PII_KEY || process.env.CRM_PII_KEY.length < 16) {
  console.error("CRM_PII_KEY (>=16 chars) is required to encrypt PII at rest");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

let scanned = 0;
let encEmail = 0;
let encPhone = 0;
let idxSet = 0;
let untouched = 0;
let dupSkipped = 0;

try {
  // Pull every contact's raw stored PII. We read the RAW columns (not via the
  // app customType) so we see ciphertext-vs-plaintext exactly as stored.
  const rows = await sql`
    SELECT id, email, phone, email_idx
    FROM crm.contacts
  `;

  for (const r of rows) {
    scanned++;
    const updates = {};

    // Email: encrypt if present and not already enc:v2.
    if (r.email != null && r.email !== "" && !isEncrypted(r.email)) {
      updates.email = encryptPii(r.email);
      encEmail++;
    }
    // Phone: same treatment.
    if (r.phone != null && r.phone !== "" && !isEncrypted(r.phone)) {
      updates.phone = encryptPii(r.phone);
      encPhone++;
    }
    // Blind index: compute from the *cleartext* email. If email is plaintext
    // we have it directly; if it's already ciphertext we can't recover the
    // cleartext here (decryption is the service's job) — but encrypted rows
    // are expected to already have email_idx set by the normal write path.
    const cleartextEmail =
      r.email != null && r.email !== "" && !isEncrypted(r.email) ? r.email : null;
    if (r.email_idx == null && cleartextEmail != null) {
      updates.email_idx = blindIndex(cleartextEmail);
      idxSet++;
    }

    if (Object.keys(updates).length === 0) {
      untouched++;
      continue;
    }

    try {
      await sql`
        UPDATE crm.contacts
        SET email     = ${updates.email     ?? r.email},
            phone     = ${updates.phone     ?? r.phone},
            email_idx = ${updates.email_idx ?? r.email_idx}
        WHERE id = ${r.id}
      `;
    } catch (e) {
      // A legacy plaintext row may be a duplicate of an already-encrypted row
      // (same email -> same blind index). The unique constraint on
      // (tenant_id, email_idx) fires: skip that one row, encrypt the rest.
      if (e && e.code === "23505") {
        // roll back the optimistic counters for this skipped row
        if (updates.email) encEmail--;
        if (updates.phone) encPhone--;
        if (updates.email_idx) idxSet--;
        dupSkipped++;
        console.warn(`skip duplicate blind index for contact ${r.id}`);
        continue;
      }
      throw e;
    }
  }

  console.log(
    JSON.stringify({
      scanned,
      encryptedEmail: encEmail,
      encryptedPhone: encPhone,
      blindIndexSet: idxSet,
      untouched,
      dupSkipped,
    }),
  );
} catch (e) {
  console.error("backfill failed:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
