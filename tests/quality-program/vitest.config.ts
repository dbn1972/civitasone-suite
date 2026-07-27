import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@civitasone/auth": resolve(__dirname, "../../packages/auth/dist/index.js"),
      "@civitasone/queue": resolve(__dirname, "../../packages/queue/dist/index.js"),
      "@civitasone/cache": resolve(__dirname, "../../packages/cache/dist/index.js"),
    },
  },
  test: {
    include: [
      "L1-tenant-isolation/**/*.test.ts",
      "L2-authz-bola/**/*.test.ts",
      "L3-data-integrity/**/*.test.ts",
      "L4-api-contract/**/*.test.ts",
      "L6-security/**/*.test.ts",
      "L7-reliability/**/*.test.ts",
      "L10-domain-correctness/**/*.test.ts",
      "L11-mutation-canary/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    env: {
      JWT_SECRET: "civitasone-dev-secret",
      GATEWAY_URL: "http://localhost:8080",
    },
    reporters: ["default", "junit"],
    outputFile: {
      junit: "../../evidence/quality-program-junit.xml",
    },
  },
});
