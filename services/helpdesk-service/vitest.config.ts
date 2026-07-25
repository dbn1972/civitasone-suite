import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://helpdesk_svc:helpdesk_dev_pw@localhost:5435/civitas_helpdesk",
      // Cross-tenant sweepers read through the BYPASSRLS scanner role
      // (migration 0016). Integration tests exercise the real cross-tenant scan.
      HELPDESK_SCANNER_DATABASE_URL:
        process.env.HELPDESK_SCANNER_DATABASE_URL ??
        "postgres://helpdesk_scanner:helpdesk_scanner_dev_pw@localhost:5435/civitas_helpdesk",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/tickets/consumer.ts",
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
