import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? "sqs",
      AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
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
