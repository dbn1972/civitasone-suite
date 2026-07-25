/**
 * Evidence storage adapter — real AWS S3 (SigV4) integration for evidence uploads
 * and integrity verification.
 *
 * Design:
 *   • `resolveStorageConfig` is a PURE function of the environment — it returns a
 *     fully-formed config only when bucket + region + credentials are all present,
 *     otherwise `null`. This gives every caller an explicit "not configured" signal
 *     instead of a fabricated success.
 *   • `generatePresignedPutUrl` produces a REAL AWS SigV4 presigned PUT URL using
 *     `@aws-sdk/s3-request-presigner`. Signing is pure offline HMAC-SHA256 math —
 *     no network round-trip is required to mint the URL.
 *   • `fetchObjectSha256` downloads the stored object and recomputes its SHA-256 so
 *     integrity can be verified against the client-declared hash. Returns `null`
 *     when the object is not retrievable (missing / access error), so the caller
 *     can mark the artifact `unverified` rather than falsely `valid`.
 *
 * Everything here is env-gated: with no bucket/credentials the service degrades to
 * an explicit not-configured status and never claims a fake upload URL or a fake
 * "valid" integrity result.
 *
 * _Requirements: 7.3, 7.4, 7.8 (SVC-103 geo-tagged evidence)_
 */
import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Config ──────────────────────────────────────────────────────────────────

/** Resolved, complete S3 configuration. Only produced when everything is present. */
export interface StorageConfig {
  bucket: string;
  region: string;
  /** Optional custom endpoint (e.g. MinIO / LocalStack). Triggers path-style addressing. */
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Environment shape consumed by `resolveStorageConfig` (subset of `process.env`). */
export type StorageEnv = Record<string, string | undefined>;

/**
 * Resolve S3 storage configuration from the environment.
 *
 * PURE + deterministic — no I/O. Returns `null` (explicit "not configured") unless
 * bucket, region, and static credentials are ALL present. This is the single source
 * of truth for whether real presigning / integrity recompute is possible.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns A complete {@link StorageConfig}, or `null` when unconfigured.
 *
 * _Validates: Requirement 7.8 (env-gated, never fake success)_
 */
export function resolveStorageConfig(env: StorageEnv = process.env): StorageConfig | null {
  const bucket = env.S3_BUCKET_NAME ?? env.EVIDENCE_S3_BUCKET;
  const region = env.S3_REGION ?? env.AWS_REGION;
  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const endpoint = env.S3_ENDPOINT;
  return {
    bucket,
    region,
    // Custom endpoints (MinIO/LocalStack) require path-style addressing.
    forcePathStyle: Boolean(endpoint),
    accessKeyId,
    secretAccessKey,
    ...(endpoint ? { endpoint } : {}),
    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
  };
}

// ── Client factory ────────────────────────────────────────────────────────────

/** Build an S3 client from a resolved config. Kept separate for testability. */
export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  });
}

// ── Presign (PUT) ───────────────────────────────────────────────────────────

/**
 * Generate a REAL AWS SigV4 presigned PUT URL for an evidence object.
 *
 * The returned URL carries the `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
 * `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires` and `X-Amz-Signature` query
 * parameters produced by offline HMAC signing — a client can `PUT` the file bytes
 * directly to S3 with no further authentication.
 *
 * @param config - Resolved storage config.
 * @param s3Key - Object key to presign.
 * @param contentType - MIME type the client will upload with.
 * @param expiresInSeconds - URL validity window.
 * @param client - Optional pre-built client (dependency injection for tests).
 * @returns The signed URL string.
 *
 * _Validates: Requirement 7.8_
 */
export async function generatePresignedPutUrl(
  config: StorageConfig,
  s3Key: string,
  contentType: string,
  expiresInSeconds: number,
  client: S3Client = createS3Client(config),
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: s3Key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

// ── Integrity (GET + hash) ────────────────────────────────────────────────────

/**
 * Download the stored object and recompute its SHA-256 hex digest.
 *
 * @param config - Resolved storage config.
 * @param s3Key - Object key to fetch.
 * @param client - Optional pre-built client (dependency injection for tests).
 * @returns Lower-case hex SHA-256 of the object bytes, or `null` when the object
 *          cannot be retrieved (missing key, access error, empty body).
 *
 * _Validates: Requirement 7.4_
 */
export async function fetchObjectSha256(
  config: StorageConfig,
  s3Key: string,
  client: S3Client = createS3Client(config),
): Promise<string | null> {
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: s3Key }),
    );
    const body = res.Body as
      | { transformToByteArray: () => Promise<Uint8Array> }
      | undefined;
    if (!body || typeof body.transformToByteArray !== "function") {
      return null;
    }
    const bytes = await body.transformToByteArray();
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    // Not retrievable (NoSuchKey, network, permissions) → caller marks unverified.
    return null;
  }
}
