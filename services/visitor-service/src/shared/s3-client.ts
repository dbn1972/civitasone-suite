/**
 * Process-wide S3Client singleton for visitor-service (document-scan upload,
 * OCR download, expired-image cleanup).
 *
 * V4-F-03: a client was previously constructed per call and never destroyed;
 * each owns its own HTTP handler and keep-alive socket pool, so the cleanup
 * worker opened up to 100 pools per cycle. One lazily-built client is reused
 * for the process lifetime.
 */
import type { S3Client } from "@aws-sdk/client-s3";

let clientPromise: Promise<S3Client> | undefined;

export function getS3Client(): Promise<S3Client> {
  clientPromise ??= (async () => {
    const endpoint = process.env.S3_ENDPOINT ?? "https://s3.amazonaws.com";
    const region = process.env.S3_REGION ?? "ap-south-1";
    const { S3Client: Client } = await import("@aws-sdk/client-s3");
    return new Client({
      region,
      ...(endpoint.includes("localhost") || endpoint.includes("localstack")
        ? { endpoint, forcePathStyle: true }
        : {}),
    });
  })().catch((err) => {
    clientPromise = undefined; // do not cache a failed construction
    throw err;
  });
  return clientPromise;
}

/** Test hook: drop the cached client (destroying it) so the next call rebuilds. */
export async function resetS3ClientForTests(): Promise<void> {
  const p = clientPromise;
  clientPromise = undefined;
  if (p) (await p.catch(() => undefined))?.destroy?.();
}
