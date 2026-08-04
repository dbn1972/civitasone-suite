/**
 * SQS fail-fast timeouts.
 *
 * Without an explicit connection/request timeout the AWS SDK waits forever: a
 * SendMessage that can never acquire a socket hangs silently and stalls the
 * outbox relay with no error ever logged. These tests pin the defaults, the
 * override parsing, and — critically — the floor that keeps requestTimeout
 * above the 20s long-poll ReceiveMessage wait so legitimate polls are not
 * aborted every cycle.
 */
import { describe, it, expect } from "vitest";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  DEFAULT_SQS_CONNECTION_TIMEOUT_MS,
  DEFAULT_SQS_REQUEST_TIMEOUT_MS,
  resolveConnectionTimeout,
  resolveRequestTimeout,
  buildRequestHandler,
} from "../src/bus.js";

/** The long-poll ReceiveMessage wait; requestTimeout must stay above it. */
const LONG_POLL_WAIT_MS = 20_000;

describe("resolveConnectionTimeout", () => {
  it("defaults to a short, finite connect ceiling", () => {
    expect(resolveConnectionTimeout(undefined)).toBe(DEFAULT_SQS_CONNECTION_TIMEOUT_MS);
    expect(DEFAULT_SQS_CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_SQS_CONNECTION_TIMEOUT_MS).toBeLessThan(LONG_POLL_WAIT_MS);
  });

  it("honours a valid override and floors fractions", () => {
    expect(resolveConnectionTimeout("3000")).toBe(3000);
    expect(resolveConnectionTimeout("2500.9")).toBe(2500);
  });

  it("falls back rather than accepting a non-positive or malformed override", () => {
    for (const raw of [undefined, "", "  ", "abc", "0", "-1", "NaN", "Infinity"]) {
      expect(resolveConnectionTimeout(raw), `input ${JSON.stringify(raw)}`).toBe(
        DEFAULT_SQS_CONNECTION_TIMEOUT_MS,
      );
    }
  });
});

describe("resolveRequestTimeout", () => {
  it("defaults above the long-poll wait so receives are never aborted", () => {
    expect(resolveRequestTimeout(undefined)).toBe(DEFAULT_SQS_REQUEST_TIMEOUT_MS);
    expect(
      DEFAULT_SQS_REQUEST_TIMEOUT_MS,
      "a request timeout at or below the 20s poll would kill every ReceiveMessage",
    ).toBeGreaterThan(LONG_POLL_WAIT_MS);
  });

  it("clamps an override that would abort the long poll up to a safe floor", () => {
    // 5s would cancel every 20s ReceiveMessage; the resolver must lift it.
    expect(resolveRequestTimeout("5000")).toBeGreaterThan(LONG_POLL_WAIT_MS);
    expect(resolveRequestTimeout("1")).toBeGreaterThan(LONG_POLL_WAIT_MS);
  });

  it("honours a valid override that clears the floor", () => {
    expect(resolveRequestTimeout("45000")).toBe(45000);
  });

  it("falls back rather than accepting a malformed override", () => {
    for (const raw of ["", "abc", "-1", "NaN"]) {
      expect(resolveRequestTimeout(raw), `input ${raw}`).toBe(
        DEFAULT_SQS_REQUEST_TIMEOUT_MS,
      );
    }
  });
});

describe("buildRequestHandler with timeouts", () => {
  it("still produces a handler the SQS client accepts", () => {
    const handler = buildRequestHandler(64);
    expect(handler).toBeInstanceOf(NodeHttpHandler);
    expect(typeof handler.handle).toBe("function");
  });
});
