/**
 * Webhook HMAC secrets at rest (FQ12-SEC): sealed with admin-service's existing
 * envelope (shared/secret-crypto.ts: "enc:v2:<keyid>:" AES-256-GCM, key from
 * PII_ENC_KEY / ADMIN_PII_KEY). The secret must stay recoverable because we
 * SIGN outbound payloads with it, so it is encrypted (not hashed) and opened
 * only at signing / verification time.
 *
 * Stored columns:
 *   webhooks.webhooks.secret            sealed
 *   webhooks.webhooks.previous_secret   sealed (grace-window slot), or NULL
 *   webhooks.secret_rotations.new_secret sealed
 *
 * Plaintext never reaches the DB, the command queue or the read cache: the
 * command handler seals before publishing, the consumer re-seals any legacy
 * in-flight plaintext payload, and routes never return a stored value.
 */
import { isSealed, openSecret, sealSecret } from "../../shared/secret-crypto.js";
import { signPayload } from "./commands.js";
import { verifyWithRotation } from "./rotation.js";

export { isSealed };

/** Seal a value unless it is already an envelope (idempotent). Throws with no key. */
export function ensureSealed(value: string): string {
  return isSealed(value) ? value : sealSecret(value);
}

/** Like ensureSealed for the nullable grace-window slot. */
export function ensureSealedOrNull(value: string | null | undefined): string | null {
  return value == null ? null : ensureSealed(value);
}

/**
 * Open a stored secret for signing. Legacy plaintext rows written before the
 * backfill are still usable (so deliveries do not break mid-rollout) until
 * scripts/backfill-webhook-secrets.mjs seals them.
 */
export function openStoredSecret(stored: string): string {
  return isSealed(stored) ? openSecret(stored) : stored;
}

export interface StoredWebhookSecrets {
  secret: string;
  previousSecret?: string | null;
}

/** Sign an outbound payload with the endpoint's CURRENT secret. */
export function signForWebhook(row: StoredWebhookSecrets, body: string): string {
  return signPayload(openStoredSecret(row.secret), body);
}

/** Verify a signature against the current secret or the grace-window previous one. */
export function verifyForWebhook(row: StoredWebhookSecrets, body: string, signature: string): boolean {
  return verifyWithRotation(
    openStoredSecret(row.secret),
    row.previousSecret ? openStoredSecret(row.previousSecret) : null,
    body,
    signature,
  );
}

/** Fixed mask for read APIs: never derived from the stored value. */
export const SECRET_MASK = "whsec_••••••••";
