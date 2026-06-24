import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-tax-config.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://payroll_svc:payroll_dev_pw@localhost:5435/civitas_payroll",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
