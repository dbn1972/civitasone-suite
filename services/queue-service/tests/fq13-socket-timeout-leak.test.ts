/**
 * FQ13 regression: SQS socket `timeout`-listener leak.
 *
 * @smithy/node-http-handler 3.x, for any requestTimeout >= 6000 ms, waited 3 s
 * and then called `request.socket.setTimeout(..., onTimeout)` on the pooled
 * keep-alive socket without ever removing that listener. Every request that
 * lasted longer than 3 s (every slow ReceiveMessage long-poll) therefore left
 * one listener behind, retaining its ClientRequest/IncomingMessage/body
 * (~11 KB each). The worker fleet grew ~20 GB/h with zero messages.
 *
 * These tests drive the REAL handler from buildRequestHandler() against a
 * local HTTP server that is deliberately slower than the 3 s defer, over a
 * single keep-alive socket, and pin:
 *   1. the reused socket does not accumulate `timeout` listeners;
 *   2. a request exceeding requestTimeout still REJECTS (fail-fast preserved;
 *      in 4.x this needs throwOnRequestTimeout, otherwise it only warns).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** Longer than the handler's 3 s listener-defer window. */
const SLOW_RESPONSE_MS = 3_500;

type BusModule = typeof import("../src/bus.js");
let bus: BusModule;
let server: Server;
let port: number;
const savedEnv = { ...process.env };

beforeAll(async () => {
  // Shrink the long-poll floor (wait + 5 s) so the fail-fast test can use a
  // 6 s requestTimeout. Must be set before bus.ts is evaluated, because the
  // floor is captured at module load. 6 s is still >= the 6000 ms threshold
  // that takes the handler's deferred (leaky in 3.x) code path.
  process.env.SQS_WAIT_TIME_SECONDS = "1";
  delete process.env.SQS_REQUEST_TIMEOUT_MS;
  delete process.env.SQS_CONNECTION_TIMEOUT_MS;
  bus = await import("../src/bus.js");

  server = createServer((req, res) => {
    const delay = Number(req.headers["x-delay-ms"] ?? SLOW_RESPONSE_MS);
    req.resume();
    const t = setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }, delay);
    res.on("close", () => clearTimeout(t));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  delete process.env.SQS_REQUEST_TIMEOUT_MS;
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env = savedEnv;
});

function request(delayMs: number = SLOW_RESPONSE_MS) {
  return {
    protocol: "http:",
    hostname: "127.0.0.1",
    port,
    method: "POST",
    path: "/",
    query: {},
    headers: { "content-type": "application/json", "x-delay-ms": String(delayMs) },
    body: "{}",
  };
}

async function drain(body: IncomingMessage): Promise<void> {
  for await (const _chunk of body) {
    // discard
  }
}

describe("FQ13: SQS request handler does not leak socket timeout listeners", () => {
  it("keeps <= 1 timeout listener on a reused keep-alive socket across slow requests", async () => {
    // maxSockets=1: every request reuses the same pooled keep-alive socket.
    const handler = bus.buildRequestHandler(1);
    try {
      const sockets = new Set<Socket>();
      const counts: number[] = [];
      for (let i = 0; i < 5; i++) {
        // Handler signature differs slightly across 3.x/4.x; a plain request
        // object is what both versions actually read.
        const { response } = await handler.handle(request() as never);
        const body = response.body as IncomingMessage;
        const socket = body.socket as Socket;
        sockets.add(socket);
        await drain(body);
        // Let the request's "close" handlers (where 4.x removes its listener) run.
        await new Promise((r) => setTimeout(r, 50));
        counts.push(socket.listenerCount("timeout"));
      }
      // Precondition: the test really exercised a single reused socket.
      expect(sockets.size, "requests must share one keep-alive socket").toBe(1);
      // Node's http.Agent itself installs one "timeout" listener per socket;
      // anything above that is a leaked per-request listener (3.3.3: 1 + N).
      expect(
        Math.max(...counts),
        `timeout listeners after each request: ${counts.join(",")}`,
      ).toBeLessThanOrEqual(1);
    } finally {
      handler.destroy();
    }
  }, 60_000);
});

describe("FQ13: fail-fast requestTimeout is preserved", () => {
  it("rejects a request that exceeds requestTimeout instead of only warning", async () => {
    process.env.SQS_REQUEST_TIMEOUT_MS = "6000";
    expect(bus.resolveRequestTimeout()).toBe(6000);
    const handler = bus.buildRequestHandler(1);
    try {
      const started = Date.now();
      // Server would answer at 12 s; the 6 s requestTimeout must abort first.
      const outcome = await handler.handle(request(12_000) as never).then(
        () => ({ ok: true as const, err: undefined }),
        (err: unknown) => ({ ok: false as const, err: err as Error }),
      );
      const elapsed = Date.now() - started;
      expect(outcome.ok, "request past requestTimeout must reject").toBe(false);
      expect(outcome.err?.name).toBe("TimeoutError");
      expect(elapsed).toBeGreaterThanOrEqual(5_500);
      expect(elapsed).toBeLessThan(11_000);
    } finally {
      handler.destroy();
    }
  }, 30_000);
});
