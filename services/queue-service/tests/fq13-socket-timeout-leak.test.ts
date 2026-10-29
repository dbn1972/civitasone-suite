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
/** Well past the 6 s requestTimeout used by the fail-fast test. */
const HANG_RESPONSE_MS = 12_000;

type BusModule = typeof import("../src/bus.js");
let bus: BusModule;
let slowServer: Server;
let hangServer: Server;
let slowPort: number;
let hangPort: number;
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

  slowServer = await startDelayedServer(SLOW_RESPONSE_MS);
  slowPort = (slowServer.address() as AddressInfo).port;
  hangServer = await startDelayedServer(HANG_RESPONSE_MS);
  hangPort = (hangServer.address() as AddressInfo).port;
});

/**
 * Local server that answers every request after a FIXED delay. The delay is a
 * constant chosen per server and is never derived from request data.
 */
async function startDelayedServer(delayMs: number): Promise<Server> {
  const srv = createServer((req, res) => {
    req.resume();
    const t = setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }, delayMs);
    res.on("close", () => clearTimeout(t));
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return srv;
}

async function stopServer(srv: Server | undefined): Promise<void> {
  if (!srv) return;
  srv.closeAllConnections();
  await new Promise<void>((resolve) => srv.close(() => resolve()));
}

afterEach(() => {
  delete process.env.SQS_REQUEST_TIMEOUT_MS;
});

afterAll(async () => {
  await stopServer(slowServer);
  await stopServer(hangServer);
  process.env = savedEnv;
});

function request(port: number) {
  return {
    protocol: "http:",
    hostname: "127.0.0.1",
    port,
    method: "POST",
    path: "/",
    query: {},
    headers: { "content-type": "application/json" },
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
        const { response } = await handler.handle(request(slowPort) as never);
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
      // hangServer answers at 12 s; the 6 s requestTimeout must abort first.
      const outcome = await handler.handle(request(hangPort) as never).then(
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
