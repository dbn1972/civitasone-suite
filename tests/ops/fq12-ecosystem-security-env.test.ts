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
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

/**
 * Production posture (review of PR #2372): a missing IDENTITY_SCANNER_DATABASE_URL
 * must refuse to load, exactly like every other scannerDbUrl() call site,
 * instead of silently falling back (which reproduces the UAT verify defect).
 *
 * NODE_ENV=production needs many injected secrets before this point. The probe
 * supplies, one at a time, whichever variable the ecosystem says is missing
 * (generated values, never literals) until the error names the identity
 * scanner DSN. Nothing is printed except the variable names in errors.
 */
function requireProd(env: Record<string, string>, home: string): { ok: boolean; stderr: string; scannerInjected: boolean } {
  const script = `
    const cfg = require(${JSON.stringify(ECOSYSTEM_PATH)});
    const e = (n) => (cfg.apps.find((a) => a.name === n) || {}).env || {};
    const want = process.env.IDENTITY_SCANNER_DATABASE_URL;
    process.stdout.write(JSON.stringify({ injected: !!want && e("identity").IDENTITY_SCANNER_DATABASE_URL === want && e("identity-worker").IDENTITY_SCANNER_DATABASE_URL === want }));
  `;
  const r = spawnSync(process.execPath, ["-e", script], {
    env: { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: "production", ...env },
    encoding: "utf8",
  });
  let scannerInjected = false;
  if (r.status === 0) {
    try { scannerInjected = (JSON.parse(r.stdout) as { injected: boolean }).injected; } catch { /* leave false */ }
  }
  return { ok: r.status === 0, stderr: r.stderr ?? "", scannerInjected };
}

function missingVar(stderr: string): string | null {
  const m = stderr.match(/\b([A-Z][A-Z0-9_]{3,})\b(?: \(or [A-Z_]+\))? (?:is )?required/);
  return m ? m[1]! : null;
}

describe("FQ12-SEC identity scanner DSN in production", () => {
  it("refuses to load without IDENTITY_SCANNER_DATABASE_URL, and uses it when injected", () => {
    const home = mkdtempSync(join(tmpdir(), "fq12-eco-prod-"));
    try {
      const env: Record<string, string> = { DATABASE_URL: `postgres://svc@db.invalid/${randomBytes(4).toString("hex")}` };
      let reached = false;
      let last = "";
      for (let i = 0; i < 120 && !reached; i++) {
        const r = requireProd(env, home);
        if (r.ok) break;
        last = r.stderr;
        const v = missingVar(r.stderr);
        if (!v) break;
        if (v === "IDENTITY_SCANNER_DATABASE_URL") { reached = true; break; }
        if (env[v] !== undefined) break; // supplied but still rejected: stop, assert below
        env[v] = randomBytes(24).toString("hex");
      }
      expect(reached, `never reached the identity scanner check; last error: ${missingVar(last) ?? "unparsed"}`).toBe(true);

      // Inject it: the error must move past it (or the file loads) and the
      // identity apps must carry exactly the injected DSN.
      env.IDENTITY_SCANNER_DATABASE_URL = `postgres://identity_scanner@db.invalid/${randomBytes(4).toString("hex")}`;
      let ok = false;
      for (let i = 0; i < 120; i++) {
        const r = requireProd(env, home);
        if (r.ok) { ok = true; expect(r.scannerInjected).toBe(true); break; }
        const v = missingVar(r.stderr);
        expect(v).not.toBe("IDENTITY_SCANNER_DATABASE_URL");
        if (!v || env[v] !== undefined) break;
        env[v] = randomBytes(24).toString("hex");
      }
      expect(ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);
});
