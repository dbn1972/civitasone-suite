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

  it("defaults to 20 seconds on real AWS (no local endpoint)", () => {
    const prevEp = process.env.AWS_ENDPOINT_URL;
    const prevEp2 = process.env.AWS_ENDPOINT;
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ENDPOINT;
    expect(resolveWaitTimeSeconds(undefined)).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(DEFAULT_SQS_WAIT_TIME_SECONDS).toBe(20);
    if (prevEp === undefined) delete process.env.AWS_ENDPOINT_URL;
    else process.env.AWS_ENDPOINT_URL = prevEp;
    if (prevEp2 === undefined) delete process.env.AWS_ENDPOINT;
    else process.env.AWS_ENDPOINT = prevEp2;
  });

  it("defaults to 2 seconds against LocalStack endpoints", () => {
    const prevEp = process.env.AWS_ENDPOINT_URL;
    process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
    expect(resolveWaitTimeSeconds(undefined)).toBe(2);
    if (prevEp === undefined) delete process.env.AWS_ENDPOINT_URL;
    else process.env.AWS_ENDPOINT_URL = prevEp;
  });

  it("accepts an override in 1..20", () => {
    expect(resolveWaitTimeSeconds("5")).toBe(5);
    expect(resolveWaitTimeSeconds("20")).toBe(20);
  });

  it("clamps above 20 and rejects non-positive / malformed to the environment default", () => {
    const prevEp = process.env.AWS_ENDPOINT_URL;
    const prevEp2 = process.env.AWS_ENDPOINT;
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ENDPOINT;
    expect(resolveWaitTimeSeconds("60")).toBe(20);
    expect(resolveWaitTimeSeconds("0")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(resolveWaitTimeSeconds("-3")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    expect(resolveWaitTimeSeconds("nope")).toBe(DEFAULT_SQS_WAIT_TIME_SECONDS);
    if (prevEp === undefined) delete process.env.AWS_ENDPOINT_URL;
    else process.env.AWS_ENDPOINT_URL = prevEp;
    if (prevEp2 === undefined) delete process.env.AWS_ENDPOINT;
    else process.env.AWS_ENDPOINT = prevEp2;
  });
});
