/**
 * @civitasone/integration-config
 *
 * A tiny, dependency-light client that lets any service resolve an external
 * integration's config + secrets from the admin-service `integration_settings`
 * registry, falling back to environment variables when the registry is not
 * wired (backward compatible by construction).
 *
 * Because CivitasOne is DB-per-service, the registry lives in the admin DB. A
 * service opts in by setting:
 *   - INTEGRATION_REGISTRY_DB_URL  → a connection string to the admin DB
 *     (a role that can read integration_settings with app.tenant_id set).
 *   - CONFIG_ENC_KEY               → the SAME AES-256-GCM key the admin-service
 *     uses to seal secrets (so we can decrypt them server-side).
 *   - INTEGRATION_ENV_SCOPE        → dev | staging | prod (default: prod).
 *
 * When either env var is absent, resolveIntegration() returns null and the
 * caller uses its existing env-var configuration. All failures are fail-safe
 * (return null) so a registry outage never takes down the send path — the
 * adapter's own fail-closed logic still applies to the env fallback.
 */
import postgres from "postgres";
import { createDecipheriv, createHash } from "node:crypto";

export type ResolvedIntegration = {
  enabled: boolean;
  endpointUrl: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type ResolveOpts = {
  provider: string;
  tenantId: string;
  envScope?: string;
};

// ── lazy shared connection ────────────────────────────────────────────────────

type Sql = ReturnType<typeof postgres>;
let sql: Sql | null = null;

function client(): Sql | null {
  const url = process.env.INTEGRATION_REGISTRY_DB_URL;
  if (!url) return null;
  if (!sql) sql = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5 });
  return sql;
}

/** Close the shared connection (for tests / graceful shutdown). */
export async function closeIntegrationConfig(): Promise<void> {
  if (sql) { await sql.end({ timeout: 5 }); sql = null; }
}

// ── crypto (mirrors admin-service central-config domain.ts) ───────────────────

const ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  return createHash("sha256").update(secret, "utf8").digest();
}

function configKey(): Buffer | null {
  const secret = process.env.CONFIG_ENC_KEY;
  if (!secret) return null;
  return deriveKey(secret);
}

/** Decrypt a `v1:iv:tag:ct` bundle back to a { field: value } secret object. */
function decryptBundle(blob: string): Record<string, string> {
  const key = configKey();
  if (!key) return {};
  const parts = blob.split(":");
  const [prefix, ivB, tagB, ctB] = parts;
  if (parts.length !== 4 || prefix !== "v1" || !ivB || !tagB || !ctB) return {};
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]);
    const parsed = JSON.parse(pt.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ── resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve one integration for a tenant from the registry, or null when the
 * registry is not configured / has no enabled row / on any error. Secrets are
 * decrypted server-side and returned in cleartext for the adapter's use only —
 * they are never logged or persisted here.
 */
export async function resolveIntegration(opts: ResolveOpts): Promise<ResolvedIntegration | null> {
  const c = client();
  if (!c || !opts.tenantId) return null;
  const env = opts.envScope ?? process.env.INTEGRATION_ENV_SCOPE ?? "prod";
  try {
    const rows = (await c.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${opts.tenantId}, true)`;
      return tx<Array<{ enabled: boolean; endpoint_url: string; config: Record<string, unknown> | null; secret_ciphertext: string | null }>>`
        SELECT enabled, endpoint_url, config, secret_ciphertext
        FROM integration_settings.integration_settings
        WHERE tenant_id = ${opts.tenantId} AND provider = ${opts.provider} AND env_scope = ${env}
        LIMIT 1`;
    })) as Array<{ enabled: boolean; endpoint_url: string; config: Record<string, unknown> | null; secret_ciphertext: string | null }>;
    const row = rows[0];
    if (!row || !row.enabled) return null;
    return {
      enabled: true,
      endpointUrl: row.endpoint_url ?? "",
      config: row.config ?? {},
      secrets: row.secret_ciphertext ? decryptBundle(row.secret_ciphertext) : {},
    };
  } catch {
    // Fail-safe: never let a registry hiccup break the caller's send path.
    return null;
  }
}

/** True when a service has opted into registry-backed resolution. */
export function registryEnabled(): boolean {
  return Boolean(process.env.INTEGRATION_REGISTRY_DB_URL);
}
