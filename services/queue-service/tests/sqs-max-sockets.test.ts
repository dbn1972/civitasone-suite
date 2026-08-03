/**
 * SQS connection ceiling.
 *
 * The AWS SDK's default of 50 sockets is a hard outage on this fleet: start()
 * runs one 20-second long poll per subscribed topic, and services subscribe to
 * far more topics than that (hrms ~143). The loops exhaust the pool, the outbox
 * relay's SendMessage queues behind them forever, and committed writes are never
 * published. These tests pin the ceiling and the parsing of its override so a
 * well-meaning "tuning" change cannot quietly restore the stall.
 */
import { describe, it, expect } from "vitest";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  DEFAULT_SQS_MAX_SOCKETS,
  resolveMaxSockets,
  buildRequestHandler,
  buildSqsAgents,
} from "../src/bus.js";

/** The largest subscriber count in the monorepo today (hrms-service). */
const LARGEST_SUBSCRIBER_COUNT = 143;

describe("resolveMaxSockets", () => {
  it("defaults comfortably above the largest subscriber count", () => {
    expect(resolveMaxSockets(undefined)).toBe(DEFAULT_SQS_MAX_SOCKETS);
    expect(
      DEFAULT_SQS_MAX_SOCKETS,
      "the default must leave headroom for publishes on top of every long poll",
    ).toBeGreaterThan(LARGEST_SUBSCRIBER_COUNT);
  });

  it("never returns the SDK default of 50, which is what caused the stall", () => {
    for (const raw of [undefined, "", "  ", "not-a-number", "0", "-1", "NaN"]) {
      expect(
        resolveMaxSockets(raw),
        `input ${JSON.stringify(raw)}`,
      ).toBeGreaterThan(50);
    }
  });

  it("honours a valid override", () => {
    expect(resolveMaxSockets("512")).toBe(512);
    expect(resolveMaxSockets("64")).toBe(64);
  });

  it("floors a fractional override rather than handing a non-integer to the agent", () => {
    expect(resolveMaxSockets("100.9")).toBe(100);
  });

  it("falls back rather than accepting an override that would reintroduce a stall", () => {
    for (const raw of ["0", "-5", "abc", "Infinity"]) {
      expect(resolveMaxSockets(raw), `input ${raw}`).toBe(
        DEFAULT_SQS_MAX_SOCKETS,
      );
    }
  });
});

describe("buildSqsAgents", () => {
  it("applies the ceiling to both schemes", () => {
    // The endpoint scheme differs by environment — LocalStack is http, deployed
    // AWS is https — so leaving either agent at the default would stall there.
    const { httpAgent, httpsAgent } = buildSqsAgents(321);
    expect(httpAgent.maxSockets).toBe(321);
    expect(httpsAgent.maxSockets).toBe(321);
  });

  it("uses the resolved default when given no explicit ceiling", () => {
    const { httpAgent, httpsAgent } = buildSqsAgents();
    expect(httpAgent.maxSockets).toBe(DEFAULT_SQS_MAX_SOCKETS);
    expect(httpsAgent.maxSockets).toBe(DEFAULT_SQS_MAX_SOCKETS);
  });

  it("keeps connections alive so a long-poll loop does not churn sockets", () => {
    expect(buildSqsAgents().httpAgent.options.keepAlive).toBe(true);
  });
});

describe("buildRequestHandler", () => {
  it("produces a handler the SQS client accepts", () => {
    const handler = buildRequestHandler(64);
    expect(handler).toBeInstanceOf(NodeHttpHandler);
    expect(typeof handler.handle).toBe("function");
  });
});
