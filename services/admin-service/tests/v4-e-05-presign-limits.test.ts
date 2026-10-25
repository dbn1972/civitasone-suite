/**
 * V4-E-05: the presigned upload URL must enforce what the route advertises.
 *  - the client-declared Content-Type must be one of the MIME types valid for
 *    the file extension (not any string), and is SIGNED into the URL;
 *  - a declared sizeBytes above the category cap is refused, and an accepted
 *    size is SIGNED into the URL as the exact content-length.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const putSpy = vi.fn(async (o?: { key?: string }) => `https://s3.example/put/${o?.key}`);
vi.mock("@civitasone/storage", () => ({
  presignedPutUrl: (o: { key: string }) => putSpy(o),
  presignedGetUrl: vi.fn(async ({ key }: { key: string }) => `https://s3.example/get/${key}`),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "11111111-aaaa-4000-8000-0000000e0501";
const USER = "cccccccc-3333-4000-8000-0000000e0501";
const auth = () => ({ authorization: `Bearer ${signToken({ sub: USER, tid: T1, roles: ["admin"], sid: "s-e05" } as never, SECRET)}` });

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => putSpy.mockClear());

const presign = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/admin/uploads/presign", headers: auth(), payload });

describe("V4-E-05 presign content-type", () => {
  it("rejects a content type that does not match the file extension", async () => {
    const res = await presign({ category: "attachment", filename: "evil.pdf", contentType: "text/html" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("INVALID_CONTENT_TYPE");
    expect(putSpy).not.toHaveBeenCalled();
  });
  it("accepts the canonical browser MIME types and signs the content-type", async () => {
    const res = await presign({ category: "photo", filename: "site.JPG", contentType: "image/jpeg" });
    expect(res.statusCode).toBe(200);
    expect(putSpy.mock.calls[0]![0]).toMatchObject({ contentType: "image/jpeg", signContentType: true });
  });
});

describe("V4-E-05 presign size limit", () => {
  it("rejects a declared size above the category cap (photo = 2 MB)", async () => {
    const res = await presign({ category: "photo", filename: "big.png", contentType: "image/png", sizeBytes: 2 * 1024 * 1024 + 1 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("FILE_TOO_LARGE");
    expect(putSpy).not.toHaveBeenCalled();
  });
  it("signs an accepted size into the URL as contentLength", async () => {
    const res = await presign({ category: "photo", filename: "ok.png", contentType: "image/png", sizeBytes: 1000 });
    expect(res.statusCode).toBe(200);
    expect(putSpy.mock.calls[0]![0]).toMatchObject({ contentLength: 1000 });
  });
  it("rejects a non-positive or fractional size", async () => {
    expect((await presign({ category: "photo", filename: "a.png", contentType: "image/png", sizeBytes: 0 })).statusCode).toBe(400);
    expect((await presign({ category: "photo", filename: "a.png", contentType: "image/png", sizeBytes: 1.5 })).statusCode).toBe(400);
  });
});
