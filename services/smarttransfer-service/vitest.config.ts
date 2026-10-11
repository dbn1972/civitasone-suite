import { randomBytes } from "node:crypto";
import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";

// smarttransfer-service is provisioned in CI (scripts/ci/bootstrap-postgres.sh
// SERVICE_DBS — role smarttransfer_svc, db civitas_smarttransfer, port 5435)
// exactly like every other service. Real-DB suites (tests/rls-isolation.test.ts,
// tests/write-path.test.ts, tests/read-routes.test.ts, tests/command-outcome.test.ts,
// tests/infra-rls.test.ts)
// need DATABASE_URL set; outside CI this fails loud rather than silently reaching
// the shared long-lived dev Postgres (REL-035 convention, mirrored from
// building-service/vitest.config.ts).
export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    env: {
      JWT_ALGORITHM: "HS256",
      // Generated per run; never a committed literal (gitleaks).
      JWT_SECRET: process.env.JWT_SECRET ?? randomBytes(32).toString("hex"),
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://smarttransfer_svc:smarttransfer_dev_pw@localhost:5435/civitas_smarttransfer"
          : (() => {
              throw new Error(
                "DATABASE_URL is not set. This suite does not silently fall back to the shared dev Postgres — export DATABASE_URL (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      // BYPASSRLS scanner role (0002) used by the worker's relay/purge; derived from
      // DATABASE_URL (same host/port/db) unless overridden. Password follows the
      // fleet `<role>_dev_pw` convention bootstrap-postgres.sh sets via the GUC.
      SMARTTRANSFER_SCANNER_DATABASE_URL:
        process.env.SMARTTRANSFER_SCANNER_DATABASE_URL ??
        (process.env.DATABASE_URL ?? "postgres://smarttransfer_svc:smarttransfer_dev_pw@localhost:5435/civitas_smarttransfer")
          .replace("smarttransfer_svc:smarttransfer_dev_pw", "smarttransfer_scanner:smarttransfer_scanner_dev_pw"),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    // Real-DB RLS suites open transactions against the same smarttransfer.*
    // tables, and tests/rls-isolation.test.ts's sabotage check takes an
    // ACCESS EXCLUSIVE lock (ALTER TABLE ... DISABLE/ENABLE RLS). forks +
    // fileParallelism:false serialises file execution so files never contend
    // on the same table's lock queue (same fix as building/trade-service).
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
    fileParallelism: false,
  },
});
