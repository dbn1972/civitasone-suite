/**
 * V4-F-05 regression: the carrier recording download must enforce a byte cap
 * (Content-Length pre-check AND a running counter on the streamed body) rather
 * than buffering an arbitrarily large carrier response in memory.
 */
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  presignedGetUrl: vi.fn().mockResolvedValue("https://s3.example.com/x"),
  getObject: vi.fn().mockResolvedValue(Buffer.from("x")),
}));

import { sqlClient } from "../src/shared/db.js";
import { downloadRecording } from "../src/modules/recordings/consumer.js";

const CAP = 1024;
let server: http.Server;
let base = "";
let chunkedBytesSent = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/small") {
      res.writeHead(200, { "content-type": "audio/wav", "content-length": "100" });
      res.end(Buffer.alloc(100, 1));
    } else if (req.url === "/declared-big") {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(CAP * 1000) });
      res.end(Buffer.alloc(CAP * 2)); // body is short; header alone must reject
    } else if (req.url === "/chunked-big") {
      // No Content-Length: chunked, effectively unbounded.
      res.writeHead(200, { "content-type": "audio/mpeg" });
      chunkedBytesSent = 0;
      const t = setInterval(() => {
        if (res.destroyed || chunkedBytesSent > CAP * 5000) { clearInterval(t); return; }
        chunkedBytesSent += 512;
        res.write(Buffer.alloc(512, 2));
      }, 1);
      res.on("close", () => clearInterval(t));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await sqlClient.end();
});

describe("V4-F-05 — recording download size cap", () => {
  it("returns content under the cap", async () => {
    const out = await downloadRecording(`${base}/small`, CAP);
    expect(out.content.length).toBe(100);
    expect(out.contentType).toBe("audio/wav");
  });

  it("rejects up front when Content-Length exceeds the cap", async () => {
    await expect(downloadRecording(`${base}/declared-big`, CAP)).rejects.toThrow(/exceeds|too large|limit/i);
  });

  it("aborts a chunked body with no Content-Length once the cap is crossed", async () => {
    await expect(downloadRecording(`${base}/chunked-big`, CAP)).rejects.toThrow(/exceeds|too large|limit/i);
    await new Promise((r) => setTimeout(r, 100));
    const afterAbort = chunkedBytesSent;
    await new Promise((r) => setTimeout(r, 100));
    // The sender stopped: the connection was torn down, not drained.
    expect(chunkedBytesSent).toBe(afterAbort);
    expect(chunkedBytesSent).toBeLessThan(CAP * 5000);
  });
});
