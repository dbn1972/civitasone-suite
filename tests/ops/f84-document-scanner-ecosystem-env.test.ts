/**
 * UAT F84 ecosystem wiring lock: document-worker must receive
 * DOCUMENT_SCANNER_DATABASE_URL (the document_scanner BYPASSRLS DSN) from the
 * launching shell. Without it the worker's cross-tenant bulk-scan discovery
 * falls back (development/test only) to DATABASE_URL = document_svc, which is
 * NOBYPASSRLS after admin-service 0058, so the dispatcher / lease sweeper /
 * upload expiry / retention would see zero rows. Production document-worker
 * already refuses to start without it (services/document-service/src/shared/
 * scanner-url.ts). Pass-through only: an UNSET var stays UNSET (never ""), and
 * only document-worker gets it (the document API never opens the scanner pool).
 *
 * Evaluated in a subprocess like f65-court-dsc-ecosystem-env.test.ts (module
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
const KEY = "DOCUMENT_SCANNER_DATABASE_URL";
const APPS = ["document-worker", "document"] as const;

function probe(extraEnv: Record<string, string> = {}): Record<string, { present: boolean; matches: boolean }> {
  const home = mkdtempSync(join(tmpdir(), "f84-eco-"));
  try {
    const script = `
      const cfg = require(${JSON.stringify(ECOSYSTEM_PATH)});
      const out = {};
      for (const app of ${JSON.stringify(APPS)}) {
        const env = (cfg.apps.find((a) => a.name === app) || {}).env || {};
        out[app] = {
          present: Object.prototype.hasOwnProperty.call(env, ${JSON.stringify(KEY)}),
          matches: env[${JSON.stringify(KEY)}] === process.env[${JSON.stringify(KEY)}],
        };
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

describe("F84 document_scanner DSN ecosystem pass-through", () => {
  it("unset in the launching shell -> absent from document-worker env (not an empty string)", () => {
    expect(probe()["document-worker"]!.present).toBe(false);
  });

  it("set in the launching shell -> passed through unchanged to document-worker only", () => {
    const r = probe({ [KEY]: "postgres://document_scanner@db-host-placeholder/civitas_document" });
    expect(r["document-worker"]).toEqual({ present: true, matches: true });
    expect(r["document"]!.present).toBe(false);
  });
});
