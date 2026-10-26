/**
 * V4-F-02: document-scan upload needs @fastify/multipart registered.
 * Inject tests: small image accepted (202), oversize rejected (413).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const TENANT = "11111111-aaaa-4000-8000-000000000056";
const DEVICE = "aaaaaaaa-0000-4000-8000-000000000056";

vi.mock("../src/modules/device-registry/device-auth.js", () => ({
  deviceAuth: vi.fn(async (req: any) => {
    req.deviceContext = { tenantId: TENANT, deviceId: DEVICE, gateId: null };
  }),
}));
vi.mock("../src/modules/document-scan/repo.js", () => ({
  getScanSession: vi.fn(),
  getOcrResult: vi.fn(),
  listScans: vi.fn(),
}));
const publishScanProcess = vi.fn(async () => undefined);
vi.mock("../src/modules/document-scan/commands.js", () => ({
  publishScanProcess: (...a: unknown[]) => (publishScanProcess as any)(...a),
}));
const s3Send = vi.fn(async () => ({}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = s3Send; },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));

import { registerMultipart, SCAN_UPLOAD_MAX_BYTES } from "../src/shared/multipart.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "../src/shared/context.js";
import documentScanRoutes from "../src/modules/document-scan/routes.js";

function multipartBody(size: number, mime = "image/png") {
  const boundary = "----v4f02boundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.png"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.alloc(size, 1), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("document-scan multipart upload (V4-F-02)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.S3_BUCKET = "test-bucket";
    app = Fastify();
    registerSchemaErrorHandler(app, HttpError);
    await registerMultipart(app);
    await app.register(documentScanRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("accepts a small image upload with 202", async () => {
    const { payload, headers } = multipartBody(2048);
    const res = await app.inject({ method: "POST", url: "/v1/visitor/scans/upload", payload, headers });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(publishScanProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversize image with 413 and stores nothing", async () => {
    s3Send.mockClear();
    publishScanProcess.mockClear();
    const { payload, headers } = multipartBody(SCAN_UPLOAD_MAX_BYTES + 1024);
    const res = await app.inject({ method: "POST", url: "/v1/visitor/scans/upload", payload, headers });
    expect(res.statusCode).toBe(413);
    expect(s3Send).not.toHaveBeenCalled();
    expect(publishScanProcess).not.toHaveBeenCalled();
  });
});
