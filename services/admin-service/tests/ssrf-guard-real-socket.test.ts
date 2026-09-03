/**
 * SSRF guard — REAL-SOCKET reproduction of the reviewer's proof (PR #923
 * round 3, Finding 1).
 *
 * The independent reviewer proved the zone-ID bypass not by asserting on
 * isBlockedHost()'s return value in isolation, but by starting a real TCP
 * listener on loopback and showing `net.connect({ host:
 * "::ffff:127.0.0.1%lo", port })` — i.e. the EXACT call tcpGreeting() makes
 * — successfully connected to it, bypassing the guard entirely at the
 * socket layer.
 *
 * This suite reproduces that proof independently, through the real
 * production code path: REGISTRY.email_smtp.test() / REGISTRY.sftp.test()
 * (the same `test()` functions the integration-settings "test connection"
 * route calls), which call the unexported tcpGreeting() internally. A real
 * net.createServer() listener is started on 127.0.0.1; we assert BOTH that
 * the probe result is SSRF_BLOCKED AND that the listener's "connection"
 * event never fires — proving the connection attempt was never even
 * ATTEMPTED, not just that some guard function returned the right boolean
 * in a vacuum.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { REGISTRY } from "../src/modules/integration-settings/providers.js";

let server: net.Server;
let port: number;
let connectionCount = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = net.createServer((socket) => {
      connectionCount++;
      // If a connection ever lands here, behave like a real SMTP server so
      // a bypassed probe would report "connected" rather than timing out —
      // makes a false-negative in the guard loudly visible as ok:true
      // instead of silently masked by a probe timeout.
      socket.write("220 unexpectedly-reached-loopback-listener\r\n");
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SSRF guard — real-socket reproduction: zone-ID bypass via tcpGreeting()", () => {
  it("email_smtp.test() with a zone-ID-suffixed loopback host never dials the socket", async () => {
    const before = connectionCount;
    const result = await REGISTRY.email_smtp.test({
      config: { host: "::ffff:127.0.0.1%lo", port, user: "u", password: "p", from: "a@b.com", secure: false },
      secrets: { password: "p" },
      endpointUrl: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF_BLOCKED");
    // The proof: the listener must NEVER have seen a connection. If the
    // guard fail-open bug were still present, this would be connectionCount
    // > before AND result.ok === true (a real "220 ..." banner read back).
    expect(connectionCount).toBe(before);
  });

  it("sftp.test() with a zone-ID-suffixed metadata-style host never dials the socket", async () => {
    const before = connectionCount;
    const result = await REGISTRY.sftp.test({
      config: {
        host: "::ffff:127.0.0.1%eth0",
        port,
        username: "u",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
        inboundPath: "/inbound",
        filePattern: "*.csv",
        columnMapping: {},
      },
      secrets: { privateKey: "fake" },
      endpointUrl: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF_BLOCKED");
    expect(connectionCount).toBe(before);
  });

  it("sanity: a NON-blocked loopback host (no guard) WOULD reach the listener — proves the listener itself works", async () => {
    // Not a guard bypass — a direct net.connect with no SSRF guard involved
    // at all, to prove the listener is live and would answer if actually
    // dialed. This is what makes the "connectionCount unchanged" assertions
    // above meaningful rather than vacuous (e.g. a listener that never
    // accepts anything).
    const before = connectionCount;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {});
      socket.once("data", () => { socket.destroy(); resolve(); });
      socket.once("error", reject);
      setTimeout(() => { socket.destroy(); reject(new Error("timed out waiting for banner")); }, 3000);
    });
    expect(connectionCount).toBe(before + 1);
  });
});
