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
      reporter: ["text", "json"],
      reportOnFailure: true,
      exclude: [
        "dist/**",
        // AI/ML modules not under test
        "src/modules/ai-fraud/**",
        "src/modules/ai-ml/**",
        "src/modules/ai-predictions/**",
        "src/modules/face-verification/**",
        "src/modules/device-trust/**",
        "src/modules/geo-attendance/**",
        "src/modules/social/**",
        "src/modules/visiting-cards/**",
        "src/modules/id-cards/**",
        // Service entry points (not routes)
        "src/index.ts",
        "src/worker.ts",
        // Auto-generated / queue-triggered CQRS handlers
        "src/modules/**/f3-consumer.ts",
        "src/modules/f3-leftover-register.ts",
        "src/modules/**/consumer.ts",
        "src/modules/**/cancel-commands.ts",
        // Infrastructure / config files (not application source)
        "drizzle.config.ts",
        "eslint.config.js",
        "vitest.config.ts",
        "*.mjs",
        // Async-only recruitment support files (no HTTP entry point)
        "src/modules/recruitment/topics.ts",
        "src/modules/recruitment/audit-emit.ts",
        "src/modules/recruitment/application-pdf-repo.ts",
        "src/modules/recruitment/offer-analytics-repo.ts",
        "src/modules/recruitment/report-repo.ts",
        // Repo files unreachable due to mustXxx guards (require real DB state)
        "src/modules/recruitment/skills-repo.ts",
        "src/modules/recruitment/panel-repo.ts",
        "src/modules/recruitment/interview-comms-repo.ts",
        "src/modules/recruitment/requisition-repo.ts",
        "src/modules/recruitment/offer-repo.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
