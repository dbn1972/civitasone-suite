export default {
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Finance service DB (for cross-tenant isolation tests)
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance",
    },
  },
};
