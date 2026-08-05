import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_SQS_WAIT_TIME_SECONDS,
  resolveWaitTimeSeconds,
} from "../src/bus.js";

describe("resolveWaitTimeSeconds", () => {
  const prev = process.env.SQS_WAIT_TIME_SECONDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.SQS_WAIT_TIME_SECONDS;
    else process.env.SQS_WAIT_TIME_SECONDS = prev;
  });

  it("defaults to 20 seconds (AWS long-poll max)", () => {
    expect(resolveWaitTimeSeconds(undefined)).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(DEFAULT_SQS_WAIT_TIME_SECONDS).toBe(20);
  });

  it("accepts an override in 1..20", () => {
    expect(resolveWaitTimeSeconds("5")).toBe(5);
    expect(resolveWaitTimeSeconds("20")).toBe(20);
  });

  it("clamps above 20 and rejects non-positive / malformed to the default", () => {
    expect(resolveWaitTimeSeconds("60")).toBe(20);
    expect(resolveWaitTimeSeconds("0")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(resolveWaitTimeSeconds("-3")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(resolveWaitTimeSeconds("nope")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
  });
});
