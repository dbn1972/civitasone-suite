import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readPiiKey(): string {
  try {
    const p = join(process.env.HOME || "/home/ec2-user", ".civitasone-hrms-pii-key");
    const v = readFileSync(p, "utf8").trim();
    if (v.length >= 16) return v;
  } catch { /* fall through */ }
  return "civitasone-hrms-pii-dev-key-not-for-prod";
}

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      PII_ENC_KEY: process.env.PII_ENC_KEY ?? readPiiKey(),
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
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
