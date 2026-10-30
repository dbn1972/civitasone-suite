/**
 * UAT F65 ecosystem wiring lock: court + court-worker must receive the DSC
 * trust-store config from the launching shell (production court refuses to
 * start without COURT_DSC_TRUST_STORE_PEM), and an UNSET var must stay unset
 * (never "") so the non-production/UAT posture is unchanged.
 *
 * Evaluated in a subprocess like fq12-ecosystem-security-env.test.ts (module
 * consts are memoized at require time). Only booleans are printed. HOME is an
 * empty temp dir so no on-host key file is read.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ECOSYSTEM_PATH = resolve(__dirname, "../..", "ecosystem.config.js");
const KEYS = ["COURT_DSC_TRUST_STORE_PEM", "COURT_DSC_REQUIRE_CHAIN_TRUST"] as const;
const APPS = ["court", "court-worker"] as const;

function probe(extraEnv: Record<string, string> = {}): Record<string, { present: boolean; matches: boolean }> {
  const home = mkdtempSync(join(tmpdir(), "f65-eco-"));
  try {
    const script = `
      const cfg = require(${JSON.stringify(ECOSYSTEM_PATH)});
      const out = {};
      for (const app of ${JSON.stringify(APPS)}) {
        const env = (cfg.apps.find((a) => a.name === app) || {}).env || {};
        for (const k of ${JSON.stringify(KEYS)}) {
          out[app + ":" + k] = {
            present: Object.prototype.hasOwnProperty.call(env, k),
            matches: env[k] === process.env[k],
          };
        }
      }
      process.stdout.write(JSON.stringify(out));
    `;
    const out = execFileSync(process.execPath, ["-e", script], {
      env: { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: "development", ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out) as Record<string, { present: boolean; matches: boolean }>;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("F65 court DSC ecosystem env pass-through", () => {
  it("unset in the launching shell -> absent from court + court-worker env (not an empty string)", () => {
    const r = probe();
    for (const app of APPS) for (const k of KEYS) expect(r[`${app}:${k}`]!.present, `${app}:${k}`).toBe(false);
  });

  it("set in the launching shell -> passed through unchanged to court + court-worker", () => {
    const r = probe({ COURT_DSC_TRUST_STORE_PEM: "pem-bundle-placeholder", COURT_DSC_REQUIRE_CHAIN_TRUST: "true" });
    for (const app of APPS) {
      for (const k of KEYS) {
        expect(r[`${app}:${k}`], `${app}:${k}`).toEqual({ present: true, matches: true });
      }
    }
  });
});
