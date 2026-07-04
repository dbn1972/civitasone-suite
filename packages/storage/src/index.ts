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

function getClient(): S3Client {
  if (_client) return _client;
  _config = loadConfig();
  _client = new S3Client({
    region: _config.region,
    ..._config.endpoint ? { endpoint: _config.endpoint } : {},
    forcePathStyle: _config.forcePathStyle,
    credentials: {
      accessKeyId: _config.accessKeyId,
      secretAccessKey: _config.secretAccessKey,
    },
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

/**
 * Check if an object exists.
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch {
    return false;
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
