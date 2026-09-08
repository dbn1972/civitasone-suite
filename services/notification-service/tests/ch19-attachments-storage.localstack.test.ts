/**
 * CH-19 / DOM-006 — genuine upload → download round trip against real S3
 * (LocalStack), not the mocked @civitasone/storage used by
 * ch19-attachments.test.ts.
 *
 * GATED on AWS_ENDPOINT_URL — exactly like queue-service's
 * sqs.localstack.test.ts. With no LocalStack this whole suite SKIPS cleanly
 * in CI (the "test"/"integration-tests" jobs have no localstack service);
 * set AWS_ENDPOINT_URL (e.g. http://localhost:4566) to run it:
 *
 *   AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test \
 *   AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-south-1 \
 *   AWS_S3_BUCKET=civitasone-test \
 *   pnpm --filter @civitasone/notification-service test -- ch19-attachments-storage.localstack
 *
 * This is the DOM-006 definition-of-done proof: the bytes an upload request
 * hands to the route are genuinely retrievable afterward via the presigned
 * URL the route returns — not merely a DB row pointing at a key nothing
 * ever wrote.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { signToken } from "@civitasone/auth";
import { resetClient, objectExists, deleteObject } from "@civitasone/storage";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const endpoint = process.env.AWS_ENDPOINT_URL;

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000190099";
const ACTOR = "cccccccc-3333-4000-8000-000000190099";
const BUCKET = process.env.AWS_S3_BUCKET ?? "civitasone-test";

function headers(roles = ["notification_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

// PDF magic bytes + a distinctive payload body, so a byte-for-byte compare
// after download actually proves something (not just "some PDF came back").
const CONTENT = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]), // %PDF-1.4
  Buffer.from(`DOM-006 round-trip proof ${randomToken()}`),
]);

function randomToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const originalFetch = globalThis.fetch;
const uploadedKeys: string[] = [];

describe.skipIf(!endpoint)("DOM-006: attachments genuinely round-trip through real S3/LocalStack", () => {
  beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID ??= "test";
    process.env.AWS_SECRET_ACCESS_KEY ??= "test";
    process.env.AWS_DEFAULT_REGION ??= "ap-south-1";
    process.env.AWS_S3_BUCKET = BUCKET;
    resetClient();

    // Idempotent bucket creation: LocalStack's `SERVICES: sqs,s3` enables S3
    // but nothing pre-creates a bucket for it (infra/localstack-init only has
    // 01-create-sqs-queues.sh) — ensure the test bucket exists here.
    const client = new S3Client({
      region: process.env.AWS_DEFAULT_REGION,
      endpoint,
      forcePathStyle: true,
      // See packages/storage/src/index.ts — WHEN_SUPPORTED (the SDK default)
      // hangs indefinitely against this environment's LocalStack S3.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw err;
    }
  }, 600_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    for (const key of uploadedKeys) {
      await deleteObject(key).catch(() => {});
    }
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM notification.message_attachments WHERE tenant_id = ${TENANT}`.catch(() => {});
    }).catch(() => {});
    await sqlClient.end();
  });

  it("upload → download proves bytes are genuinely retrievable (not a fake URL)", async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // Let the real request through to whatever the presigned URL points at
      // (real LocalStack S3); only the ClamAV scan call is stubbed.
      if (url.includes("/scan")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ infected: false, status: "clean" }),
        } as Response);
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const app = await buildApp();
    const uploadRes = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "roundtrip.pdf",
        mimeType: "application/pdf",
        data: CONTENT.toString("base64"),
      },
    });

    expect(uploadRes.statusCode).toBe(200);
    const uploadBody = uploadRes.json();
    const { id, downloadUrl } = uploadBody.data;
    expect(downloadUrl).toContain(BUCKET);
    expect(downloadUrl).toContain(`attachments/${TENANT}/`);
    expect(downloadUrl).toContain("X-Amz-Signature=");

    // 1. The object genuinely exists in S3 under the returned key — not a
    //    key referenced only by the DB row.
    const storageKeyMatch = downloadUrl.match(new RegExp(`${BUCKET}/(attachments/[^?]+)`));
    expect(storageKeyMatch).not.toBeNull();
    const storageKey = decodeURIComponent(storageKeyMatch![1]);
    uploadedKeys.push(storageKey);
    expect(await objectExists(storageKey)).toBe(true);

    // 2. Fetching the presigned URL the route handed back — exactly what a
    //    real client would do — returns the EXACT bytes that were uploaded.
    const downloadResponse = await originalFetch(downloadUrl);
    expect(downloadResponse.status).toBe(200);
    const downloadedBytes = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloadedBytes.equals(CONTENT)).toBe(true);

    // 3. The service's own download endpoint round-trips through the same
    //    real presigned URL (independently re-signed, same object).
    const downloadRouteRes = await app.inject({
      method: "GET",
      url: `/notifications/attachments/${id}/download`,
      headers: headers(),
    });
    await app.close();
    expect(downloadRouteRes.statusCode).toBe(200);
    const secondUrl = downloadRouteRes.json().data.downloadUrl;
    const secondFetch = await originalFetch(secondUrl);
    const secondBytes = Buffer.from(await secondFetch.arrayBuffer());
    expect(secondBytes.equals(CONTENT)).toBe(true);
  }, 600_000);
});
