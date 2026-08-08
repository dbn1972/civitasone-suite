import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Default to in-memory so unit tests do not require LocalStack. The
      // LocalStack suite (sqs.localstack.test.ts) is gated on AWS_ENDPOINT_URL
      // and must only run when an operator explicitly points at a live broker —
      // defaulting the endpoint here both enabled those tests against a dead
      // :4566 and collapsed the SQS long-poll wait floor to 2s.
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? "memory",
      ...(process.env.AWS_ENDPOINT_URL
        ? { AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL }
        : {}),
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "ap-south-1",
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
    testTimeout: 90000,
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
