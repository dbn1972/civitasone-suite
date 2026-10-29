/**
 * FQ12-SEC ecosystem wiring locks.
 *
 *  - identity + identity-worker must carry IDENTITY_SCANNER_DATABASE_URL for
 *    the identity_scanner BYPASSRLS role. Without it shared/scanner-db.ts fell
 *    back to the NOBYPASSRLS identity_svc DSN and API-key verify could never
 *    see a row under FORCE RLS (UAT items #69-#72: "unknown key").
 *  - admin-worker must carry the same PII_ENC_KEY as the admin API: webhook
 *    HMAC secrets are sealed at rest with it.
 *
 * Evaluated in a subprocess (module-level consts are memoized at require
 * time; see sec-017-ecosystem-is-prod-allowlist.test.ts). Only booleans are
 * printed, never a DSN or key value. HOME points at an empty temp dir so no
 * on-host key file is read.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ECOSYSTEM_PATH = resolve(__dirname, "../..", "ecosystem.config.js");

function probe(nodeEnv: string, extraEnv: Record<string, string> = {}): Record<string, boolean> {
  const home = mkdtempSync(join(tmpdir(), "fq12-eco-"));
  try {
    const script = `
      const cfg = require(${JSON.stringify(ECOSYSTEM_PATH)});
      const env = (n) => (cfg.apps.find((a) => a.name === n) || {}).env || {};
      const scan = (n) => env(n).IDENTITY_SCANNER_DATABASE_URL;
      const isScanner = (u) => typeof u === "string" && /^postgres(ql)?:\\/\\/identity_scanner[:@]/.test(u);
      process.stdout.write(JSON.stringify({
        identityScanner: isScanner(scan("identity")),
        identityWorkerScanner: isScanner(scan("identity-worker")),
        scannerDiffersFromPrimary: scan("identity") !== env("identity").DATABASE_URL,
        adminWorkerHasKey: typeof env("admin-worker").PII_ENC_KEY === "string" && env("admin-worker").PII_ENC_KEY.length >= 16,
        adminWorkerKeyMatchesApi: env("admin-worker").PII_ENC_KEY === env("admin").PII_ENC_KEY,
      }));
    `;
    const out = execFileSync(process.execPath, ["-e", script], {
      env: { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: nodeEnv, ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out) as Record<string, boolean>;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("FQ12-SEC ecosystem env wiring", () => {
  it("identity API + worker get the identity_scanner DSN (distinct from DATABASE_URL)", () => {
    const r = probe("development");
    expect(r.identityScanner).toBe(true);
    expect(r.identityWorkerScanner).toBe(true);
    expect(r.scannerDiffersFromPrimary).toBe(true);
  });

  it("an injected IDENTITY_SCANNER_DATABASE_URL wins", () => {
    const r = probe("development", { IDENTITY_SCANNER_DATABASE_URL: "postgres://identity_scanner@db.invalid/civitas_identity" });
    expect(r.identityScanner).toBe(true);
  });

  it("admin-worker carries the same webhook-sealing key as the admin API", () => {
    const r = probe("development");
    expect(r.adminWorkerHasKey).toBe(true);
    expect(r.adminWorkerKeyMatchesApi).toBe(true);
  });
});
