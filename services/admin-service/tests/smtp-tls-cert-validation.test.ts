/**
 * CodeQL js/disabling-certificate-validation (alert 62): the SMTP "test connection" probe must verify the
 * server certificate on the TLS path instead of connecting with rejectUnauthorized:false.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

const connectCalls: Array<Record<string, unknown>> = [];

vi.mock("node:tls", () => {
  const connect = (opts: Record<string, unknown>) => {
    connectCalls.push(opts);
    const sock = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: () => void };
    sock.setTimeout = () => undefined;
    sock.destroy = () => undefined;
    queueMicrotask(() => sock.emit("data", Buffer.from("220 smtp.example.gov.in ESMTP\r\n")));
    return sock;
  };
  return { default: { connect }, connect };
});
vi.mock("../src/shared/ssrf-guard.js", () => ({
  isBlockedHost: vi.fn(async () => false),
  isBlockedAfterResolve: vi.fn(async () => false),
}));

describe("email_smtp test probe TLS verification", () => {
  it("never disables certificate validation on the SMTPS path", async () => {
    const { REGISTRY } = await import("../src/modules/integration-settings/providers.js");
    const res = await REGISTRY.email_smtp.test({ config: { host: "smtp.example.gov.in", port: 465 } } as never);
    expect(res.ok).toBe(true);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0]!.rejectUnauthorized).not.toBe(false);
    expect(connectCalls[0]!.servername).toBe("smtp.example.gov.in");
  });
});
