/**
 * L8 — AI / External Integration: No Fabricated Verdicts (P1)
 *
 * FINDING THIS GATE ENCODES
 * -------------------------
 * Every gov-integration route in identity-service correctly fails closed with
 * 503 NOT_CONFIGURED when its credential env var is absent. But once ANY
 * non-empty value is present, several routes return a HARDCODED verification
 * verdict without ever contacting the upstream authority:
 *
 *   validate-pan            -> { valid: true,  name: "VERIFIED" }
 *   digilocker/pull-document-> { verified: true, uri: "dl://..." }
 *   gstn/verify/:gstin      -> { tradeName: "Verified Entity", status: "active" }
 *
 * Consequence: setting `NIC_API_KEY=x` in staging makes EVERY PAN validate as
 * VERIFIED. An officer or downstream module cannot distinguish this from a real
 * NIC response. For a government KYC surface that is a fabrication of statutory
 * verification — worse than an outright outage, because it is silent.
 *
 * "Env-gated externals fail-closed, never fabricate" — fail-closed passes here,
 * never-fabricate does not.
 *
 * This is a STATIC gate (source analysis) because the runtime behaviour only
 * appears when a credential is configured, which the test environment must not
 * do. It ratchets against a recorded inventory so no NEW fabricating route can
 * be added, and the existing ones are tracked as debt rather than laundered.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";

const REPO_ROOT = resolve(__dirname, "../../..");
const SERVICES_DIR = join(REPO_ROOT, "services");

/**
 * Known-fabricating route handlers that existed when this gate landed.
 * These are TRACKED DEBT, not approved behaviour. Each must either call the real
 * upstream or return an explicit "unverified / stub" marker in its payload.
 * Removing an entry after a real fix is required — a stale entry fails the gate.
 */
const KNOWN_FABRICATIONS: Record<string, string[]> = {
  "identity-service/src/modules/gov-integrations/routes.ts": [
    // P1 — most severe: any 6-digit OTP returns verified:true for Aadhaar eKYC.
    "aadhaar/otp-verify",
    "validate-pan",
    "digilocker/pull-document",
    "gstn/verify",
  ],
};

/**
 * A verdict field is a claim about an EXTERNAL authority's answer. Hardcoding it
 * true is a fabrication. `status: "submitted"` / `"processing"` on a queued
 * request is NOT a verdict — it describes our own queue state — so those are
 * deliberately excluded.
 */
const VERDICT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bvalid:\s*true\b/, label: "valid: true" },
  { re: /\bverified:\s*true\b/, label: "verified: true" },
  { re: /\bisVerified:\s*true\b/, label: "isVerified: true" },
  { re: /\bkycStatus:\s*["'](?:verified|success|ok)["']/i, label: "kycStatus hardcoded" },
  { re: /\bname:\s*["']VERIFIED["']/i, label: 'name: "VERIFIED"' },
  { re: /\btradeName:\s*["']Verified\b/i, label: 'tradeName: "Verified ..."' },
];

/** Files that talk to an external government/AI authority. */
function integrationRouteFiles(): string[] {
  const found: string[] = [];
  if (!existsSync(SERVICES_DIR)) return found;
  for (const svc of readdirSync(SERVICES_DIR)) {
    const modulesDir = join(SERVICES_DIR, svc, "src", "modules");
    if (!existsSync(modulesDir)) continue;
    for (const mod of readdirSync(modulesDir)) {
      // Integration-bearing module names.
      if (!/gov-integrations|integrations|^ai$|intelligence/.test(mod)) continue;
      const routes = join(modulesDir, mod, "routes.ts");
      if (existsSync(routes)) found.push(routes);
    }
  }
  return found;
}

interface Fabrication {
  file: string;
  routePath: string;
  marker: string;
}

/** Split a routes file into per-handler blocks so a verdict maps to its route. */
function findFabrications(absFile: string): Fabrication[] {
  const rel = absFile.slice(SERVICES_DIR.length + 1).replace(/\\/g, "/");
  const src = readFileSync(absFile, "utf8");
  const out: Fabrication[] = [];

  // Match `app.get("/path"` / `app.post("/path"` and treat everything up to the
  // next such call as that handler's body.
  const handlerRe = /app\.(?:get|post|patch|put|delete)\(\s*["']([^"']+)["']/g;
  const starts: Array<{ path: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = handlerRe.exec(src)) !== null) {
    starts.push({ path: m[1]!, index: m.index });
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : src.length;
    const body = src.slice(start.index, end);

    // Only a handler that is env-gated can reach the fabricated branch; an
    // ungated hardcoded response is a different (stub-route) problem.
    const envGated = /process\.env\.[A-Z0-9_]+/.test(body);
    if (!envGated) continue;

    for (const { re, label } of VERDICT_PATTERNS) {
      if (re.test(body)) out.push({ file: rel, routePath: start.path, marker: label });
    }
  }
  return out;
}

/** Normalise a route path to the short key used in KNOWN_FABRICATIONS. */
function matchesKnownKey(routePath: string, key: string): boolean {
  return routePath.includes(key);
}

describe("L8 — External integrations must not fabricate verification verdicts", () => {
  const files = integrationRouteFiles();

  it("discovers integration route files to analyse", () => {
    // If discovery breaks, every assertion below silently passes on an empty set.
    expect(files.length).toBeGreaterThan(0);
  });

  it("no NEW route hardcodes an external verification verdict", () => {
    const all = files.flatMap(findFabrications);

    const unexpected = all.filter((f) => {
      const known = KNOWN_FABRICATIONS[f.file];
      if (!known) return true;
      return !known.some((k) => matchesKnownKey(f.routePath, k));
    });

    if (unexpected.length > 0) {
      const detail = unexpected
        .map((f) => `  ${f.file} :: ${f.routePath} -> ${f.marker}`)
        .join("\n");
      expect.fail(
        `${unexpected.length} route(s) hardcode an external verification verdict behind ` +
          `an env gate. Once the credential is set to any value, these return an ` +
          `authoritative-looking result without contacting the upstream authority:\n${detail}\n\n` +
          `Fix: call the real upstream, or mark the payload explicitly unverified ` +
          `(e.g. { verified: false, source: "stub" }) so callers cannot mistake it ` +
          `for a statutory verification.`,
      );
    }
  });

  it("baseline is not stale — every tracked fabrication still exists", () => {
    const all = files.flatMap(findFabrications);
    const stale: string[] = [];

    for (const [file, routes] of Object.entries(KNOWN_FABRICATIONS)) {
      for (const key of routes) {
        const stillPresent = all.some(
          (f) => f.file === file && matchesKnownKey(f.routePath, key),
        );
        if (!stillPresent) stale.push(`${file} :: ${key}`);
      }
    }

    if (stale.length > 0) {
      expect.fail(
        `Fixed fabrication(s) still listed in KNOWN_FABRICATIONS — remove them so a ` +
          `regression cannot slip back in for free:\n${stale.map((s) => `  ${s}`).join("\n")}`,
      );
    }
  });

  it("records the tracked fabrication inventory (visibility, not approval)", () => {
    const all = files.flatMap(findFabrications);
    // This is documentation-by-assertion: the count is the debt owed.
    const total = Object.values(KNOWN_FABRICATIONS).reduce((n, r) => n + r.length, 0);
    expect(all.length).toBeGreaterThanOrEqual(total);
  });
});
