/**
 * CH-19 — Attachment MIME validation + malware scan + size cap.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000190001";
const ACTOR = "cccccccc-3333-4000-8000-000000190001";

function headers(roles = ["notification_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

// PDF magic bytes: %PDF-1.4
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A]);
// EXE magic bytes: MZ
const EXE_MAGIC = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);

const originalFetch = globalThis.fetch;

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM notification.message_attachments WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
  await sqlClient.end();
});

describe("CH-19: Attachment Upload/Download", () => {
  it("upload valid PDF → 200, scan_status=clean (mock ClamAV returning clean)", async () => {
    // Mock ClamAV returning clean
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ infected: false, status: "clean" }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "report.pdf",
        mimeType: "application/pdf",
        data: PDF_MAGIC.toString("base64"),
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.scanStatus).toBe("clean");
    expect(body.data.mimeType).toBe("application/pdf");
    expect(body.data.filename).toBe("report.pdf");
    expect(body.data.downloadUrl).toContain("attachments/");
  });

  it("upload .exe → 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "malware.exe",
        mimeType: "application/x-msdownload",
        data: EXE_MAGIC.toString("base64"),
      },
    });
    await app.close();

    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("upload >10MB → 413", async () => {
    // Create a large base64 string that decodes to >10MB
    // 10MB + 1 byte in base64 is about 14MB — we'll just set a smaller limit for testing
    // Actually, let's set env to 100 bytes for this test
    const original = process.env.MAX_ATTACHMENT_SIZE_BYTES;
    process.env.MAX_ATTACHMENT_SIZE_BYTES = "100";

    // Need to rebuild app with new env
    const app = await buildApp();
    const largeBuffer = Buffer.alloc(200, 0x25); // Exceeds 100 byte limit
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "large.pdf",
        mimeType: "application/pdf",
        data: largeBuffer.toString("base64"),
      },
    });
    await app.close();

    process.env.MAX_ATTACHMENT_SIZE_BYTES = original;
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("FILE_TOO_LARGE");
  });

  it("upload infected file → 422 (mock ClamAV returning infected)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ infected: true, status: "infected" }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "virus.pdf",
        mimeType: "application/pdf",
        data: PDF_MAGIC.toString("base64"),
      },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MALWARE_DETECTED");
  });

  it("ClamAV unavailable → scan_status=pending (file stored but flagged)", async () => {
    // Mock ClamAV failure
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "document.pdf",
        mimeType: "application/pdf",
        data: PDF_MAGIC.toString("base64"),
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.scanStatus).toBe("pending");
  });

  it("download clean file → presigned URL", async () => {
    // First upload a clean file
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ infected: false, status: "clean" }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const uploadRes = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "clean.pdf",
        mimeType: "application/pdf",
        data: PDF_MAGIC.toString("base64"),
      },
    });
    const attachmentId = uploadRes.json().data.id;

    const downloadRes = await app.inject({
      method: "GET",
      url: `/notifications/attachments/${attachmentId}/download`,
      headers: headers(),
    });
    await app.close();

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.json().data.downloadUrl).toContain("attachments/");
    expect(downloadRes.json().data.scanStatus).toBe("clean");
  });

  it("download infected file → 403", async () => {
    // Insert an infected attachment directly
    const infectedId = "ffffffff-9999-4000-8000-000000190001";
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO notification.message_attachments
          (id, tenant_id, filename, mime_type, size_bytes, storage_key, scan_status, uploaded_by)
        VALUES
          (${infectedId}, ${TENANT}, 'bad.pdf', 'application/pdf', 1024, 'attachments/bad.pdf', 'infected', ${ACTOR})
        ON CONFLICT (id) DO NOTHING
      `;
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/attachments/${infectedId}/download`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("INFECTED_FILE");
  });

  it("get attachment metadata → presigned URL + expiresAt", async () => {
    // First upload a clean file
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ infected: false, status: "clean" }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const uploadRes = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        filename: "meta-test.pdf",
        mimeType: "application/pdf",
        data: PDF_MAGIC.toString("base64"),
      },
    });
    const attachmentId = uploadRes.json().data.id;

    const metaRes = await app.inject({
      method: "GET",
      url: `/notifications/attachments/${attachmentId}`,
      headers: headers(),
    });
    await app.close();

    expect(metaRes.statusCode).toBe(200);
    const data = metaRes.json().data;
    expect(data.id).toBe(attachmentId);
    expect(data.filename).toBe("meta-test.pdf");
    expect(data.mimeType).toBe("application/pdf");
    expect(data.presignedUrl).toContain("attachments/");
    expect(data.expiresAt).toBeDefined();
    // Verify expiresAt is roughly 24h from now
    const expiresMs = new Date(data.expiresAt).getTime() - Date.now();
    expect(expiresMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiresMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      payload: { filename: "test.pdf", data: "abc" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires appropriate role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/attachments/upload",
      headers: headers(["employee"]),
      payload: { filename: "test.pdf", data: "abc" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
