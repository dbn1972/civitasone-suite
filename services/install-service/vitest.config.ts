import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://install_svc:install_dev_pw@localhost:5435/civitas_install",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
