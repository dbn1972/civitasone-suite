/**
 * CLOS3-S6-13: the S3 client must have finite connect/request timeouts. The AWS SDK v3
 * NodeHttpHandler defaults are undefined (no timeout), so a stalled S3/MinIO endpoint hung
 * getObject/putObject/headObject/deleteObject (and the body stream) forever.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import net from "node:net";
import { getObject, headObject, resetClient, s3TimeoutConfig } from "./index.js";

const ENV_KEYS = [
  "S3_CONNECT_TIMEOUT_MS", "S3_REQUEST_TIMEOUT_MS", "AWS_ENDPOINT_URL",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET", "AWS_DEFAULT_REGION",
];
let saved: Record<string, string | undefined> = {};
let server: net.Server | undefined;
const sockets: net.Socket[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.AWS_S3_BUCKET = "b";
  resetClient();
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetClient();
  for (const s of sockets.splice(0)) s.destroy();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

describe("s3TimeoutConfig", () => {
  it("defaults to finite positive timeouts", () => {
    delete process.env.S3_CONNECT_TIMEOUT_MS;
    delete process.env.S3_REQUEST_TIMEOUT_MS;
    const c = s3TimeoutConfig();
    expect(Number.isFinite(c.connectionTimeout) && c.connectionTimeout > 0).toBe(true);
    expect(Number.isFinite(c.requestTimeout) && c.requestTimeout > 0).toBe(true);
  });

  it("honours env overrides", () => {
    process.env.S3_CONNECT_TIMEOUT_MS = "1234";
    process.env.S3_REQUEST_TIMEOUT_MS = "4321";
    expect(s3TimeoutConfig()).toEqual({ connectionTimeout: 1234, requestTimeout: 4321 });
  });

  it.each(["abc", "0", "-5", "NaN", "Infinity", ""])("falls back to the default for bad value %j", (bad) => {
    delete process.env.S3_CONNECT_TIMEOUT_MS;
    delete process.env.S3_REQUEST_TIMEOUT_MS;
    const dflt = s3TimeoutConfig();
    process.env.S3_CONNECT_TIMEOUT_MS = bad;
    process.env.S3_REQUEST_TIMEOUT_MS = bad;
    expect(s3TimeoutConfig()).toEqual(dflt);
  });
});

describe("stalled endpoint", () => {
  it("getObject rejects within the request timeout instead of hanging", async () => {
    server = net.createServer((s) => { sockets.push(s); /* accept, never reply */ });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server!.address() as net.AddressInfo).port;
    process.env.AWS_ENDPOINT_URL = `http://127.0.0.1:${port}`;
    process.env.S3_REQUEST_TIMEOUT_MS = "300";
    process.env.S3_CONNECT_TIMEOUT_MS = "300";
    resetClient();

    const started = Date.now();
    await expect(getObject("k")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2500);
  }, 8000);

  it("headObject also rejects (not null) on a stalled endpoint", async () => {
    server = net.createServer((s) => { sockets.push(s); });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    process.env.AWS_ENDPOINT_URL = `http://127.0.0.1:${(server!.address() as net.AddressInfo).port}`;
    process.env.S3_REQUEST_TIMEOUT_MS = "300";
    resetClient();
    await expect(headObject("k")).rejects.toThrow();
  }, 8000);
});
