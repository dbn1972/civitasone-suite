/**
 * @civitasone/storage — S3-compatible object storage with real SigV4 presigned URLs.
 *
 * Wraps @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner to provide:
 *   - presignedPutUrl(key, contentType, expiresIn) → signed PUT URL for browser upload
 *   - presignedGetUrl(key, expiresIn) → signed GET URL for download
 *   - putObject(key, body, contentType) → direct server-side upload
 *   - getObject(key) → stream/buffer download
 *   - deleteObject(key) → removal
 *
 * Env vars:
 *   AWS_ENDPOINT_URL       — custom endpoint (LocalStack: http://localhost:4566)
 *   AWS_DEFAULT_REGION     — region (default: ap-south-1)
 *   AWS_S3_BUCKET          — bucket name (default: civitasone)
 *   AWS_ACCESS_KEY_ID      — credentials
 *   AWS_SECRET_ACCESS_KEY  — credentials
 *   S3_FORCE_PATH_STYLE    — "true" for LocalStack (default: true when endpoint is localhost)
 *
 * Fail-closed: throws StorageNotConfiguredError if credentials are missing in production.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Error ─────────────────────────────────────────────────────────

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

// ── Config ────────────────────────────────────────────────────────

export interface StorageConfig {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function loadConfig(): StorageConfig {
  const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
  const region = process.env.AWS_DEFAULT_REGION || "ap-south-1";
  const bucket = process.env.AWS_S3_BUCKET || "civitasone";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "";

  if (!accessKeyId || !secretAccessKey) {
    if (process.env.NODE_ENV === "production") {
      throw new StorageNotConfiguredError(
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for S3 storage"
      );
    }
  }

  const isLocalStack = endpoint?.includes("localhost") || endpoint?.includes("127.0.0.1");
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || isLocalStack === true;

  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle };
}

// ── Client singleton ──────────────────────────────────────────────

let _client: S3Client | null = null;
let _config: StorageConfig | null = null;

const DEFAULT_S3_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_S3_REQUEST_TIMEOUT_MS = 60_000;

function envMs(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * CLOS3-S6-13: socket timeouts for the S3 client. The SDK's NodeHttpHandler has NO default
 * timeouts, so a stalled endpoint hung every call (and the body stream) forever. requestTimeout is a
 * socket-idle timeout, so a large but progressing download is not cut off.
 * Overridable via S3_CONNECT_TIMEOUT_MS / S3_REQUEST_TIMEOUT_MS; invalid values fall back to the defaults.
 */
export function s3TimeoutConfig(): { connectionTimeout: number; requestTimeout: number } {
  return {
    connectionTimeout: envMs("S3_CONNECT_TIMEOUT_MS", DEFAULT_S3_CONNECT_TIMEOUT_MS),
    requestTimeout: envMs("S3_REQUEST_TIMEOUT_MS", DEFAULT_S3_REQUEST_TIMEOUT_MS),
  };
}

function getClient(): S3Client {
  if (_client) return _client;
  _config = loadConfig();
  _client = new S3Client({
    region: _config.region,
    ..._config.endpoint ? { endpoint: _config.endpoint } : {},
    forcePathStyle: _config.forcePathStyle,
    // The SDK builds a NodeHttpHandler from these options (no extra dependency needed).
    // throwOnRequestTimeout: without it recent @smithy/node-http-handler only WARNS when
    // requestTimeout elapses and the call still hangs.
    requestHandler: { ...s3TimeoutConfig(), throwOnRequestTimeout: true },
    credentials: {
      accessKeyId: _config.accessKeyId,
      secretAccessKey: _config.secretAccessKey,
    },
    // DOM-006: the SDK v3 default (WHEN_SUPPORTED) streams a trailing CRC32
    // checksum with every PUT/GET, which this environment's LocalStack S3
    // never completes a response for -- PutObjectCommand/GetObjectCommand
    // hang indefinitely (confirmed: identical request resolves instantly
    // once these are set to WHEN_REQUIRED). Real AWS S3 accepts either
    // setting; WHEN_REQUIRED only skips the checksum when the specific API
    // call does not mandate one, so this is not a LocalStack-only workaround.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return _client;
}

function getBucket(): string {
  if (!_config) _config = loadConfig();
  return _config.bucket;
}

// ── Public API ────────────────────────────────────────────────────

export interface PresignedUrlOptions {
  /** S3 object key (path) */
  key: string;
  /** Content type (required for PUT) */
  contentType?: string | undefined;
  /** URL expiry in seconds (default: 300 for PUT, 3600 for GET) */
  expiresIn?: number | undefined;
  /**
   * PUT only: exact byte length of the upload. It is SIGNED into the URL, so
   * the object store rejects a body of any other length.
   */
  contentLength?: number | undefined;
  /**
   * PUT only: server-side encryption at rest (SSE-S3 "AES256" or SSE-KMS).
   * The header is SIGNED into the URL, so the uploader must send
   * `x-amz-server-side-encryption` with the PUT -- an upload that omits it
   * fails the signature check rather than landing unencrypted.
   */
  serverSideEncryption?: "AES256" | "aws:kms" | undefined;
}

/**
 * Generate a SigV4 presigned PUT URL for direct browser upload.
 * The returned URL includes X-Amz-Signature and all required AWS auth params.
 */
export async function presignedPutUrl(opts: PresignedUrlOptions): Promise<string> {
  const client = getClient();
  const input: PutObjectCommandInput = {
    Bucket: getBucket(),
    Key: opts.key,
    ContentType: opts.contentType ?? "application/octet-stream",
    ...(opts.contentLength !== undefined ? { ContentLength: opts.contentLength } : {}),
    ...(opts.serverSideEncryption ? { ServerSideEncryption: opts.serverSideEncryption } : {}),
  };
  const command = new PutObjectCommand(input);
  return getSignedUrl(client, command, { expiresIn: opts.expiresIn ?? 300 });
}

/**
 * Generate a SigV4 presigned GET URL for downloading an object.
 */
export async function presignedGetUrl(opts: PresignedUrlOptions): Promise<string> {
  const client = getClient();
  const input: GetObjectCommandInput = {
    Bucket: getBucket(),
    Key: opts.key,
  };
  const command = new GetObjectCommand(input);
  return getSignedUrl(client, command, { expiresIn: opts.expiresIn ?? 3600 });
}

/**
 * Upload a buffer/string directly from the server to S3.
 */
export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: typeof body === "string" ? Buffer.from(body, "utf-8") : body,
    ContentType: contentType,
  }));
}

/**
 * Download an object from S3 as a Buffer.
 */
export async function getObject(key: string): Promise<Buffer> {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
  const stream = res.Body;
  if (!stream) throw new Error(`S3 object ${key} has no body`);
  // Collect stream to buffer
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete an object from S3.
 */
export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
}

/** True only when the store says the object is absent (HEAD 404 / NotFound / NoSuchKey). */
function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === "NotFound" || err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
}

/**
 * Check if an object exists. Resolves false ONLY when the store reports it absent;
 * any other failure (403, network, 5xx) rejects, so callers can fail closed with 503.
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch (e) {
    // CLOS2-S6-06: false ONLY for a genuine not-found; a 403, timeout or 5xx is
    // "could not tell", which must not be reported as "does not exist".
    if (isNotFound(e)) return false;
    throw e;
  }
}

/**
 * HEAD an object: its stored size and content type, or null when it does not
 * exist. Any other failure (403, network, 5xx) rejects. `objectExists` is unchanged for other callers.
 */
export async function headObject(key: string): Promise<{ contentLength: number | null; contentType: string | null } | null> {
  const client = getClient();
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return { contentLength: r.ContentLength ?? null, contentType: r.ContentType ?? null };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Reset internal client (for testing). */
export function resetClient(): void {
  _client = null;
  _config = null;
}

/** Get the bucket name from config. */
export function bucketName(): string {
  return getBucket();
}
