import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "routes.ts" || name.endsWith("-routes.ts") || name.endsWith("-route.ts")) out.push(p);
    }
  };
  walk(MODULES);
  return out;
}

const SYNC_WRITE = /\b(?:db|tx)\.(?:insert|update|delete|execute)\s*\(|\bdb\.transaction\s*\(|await\s+repo\.(?:insert|update|delete|create|save|upsert|attest|transition)\w*\s*\(/;

/**
 * Sites that are DELIBERATELY exempt from the sync-write scan below because
 * they are intentional, reviewed synchronous writes — not accidental F3
 * leftovers. Each entry pins exactly one `<module-relative-path>:<line>` (not
 * a whole file) so that a future refactor which moves the line re-triggers
 * this test and forces a fresh look, instead of silently carrying a stale
 * exemption forward. Add a new entry ONLY with a comment here explaining why
 * an async `publishF3Write` conversion is unsafe at that exact site, and
 * check the same reasoning is also written at the site itself.
 *
 * - recruitment/otp-verify-routes.ts:96 — `db.transaction(...)` wrapping the
 *   `SELECT ... FOR UPDATE` read + conditional `repo.markVerified` write,
 *   made synchronous by PR #912 to close a double-token-issuance race: two
 *   concurrent requests submitting the same correct OTP code could both pass
 *   `verifyOtp` before either write landed, and both get issued a "verified"
 *   response. The fix locks the challenge row and writes `verified = true`
 *   inside that same transaction, before the lock releases, so a second
 *   concurrent request blocks on the lock and then observes `verified =
 *   true` once it acquires it. Routing `markVerified` back through the
 *   async `publishF3Write` queue would reopen exactly this gap — the decide
 *   ("code is correct") and the durable write ("mark verified") would again
 *   happen in two separate steps with a window between them, which is the
 *   root cause PR #912 fixed. See the comment directly above the
 *   `db.transaction` call in that file for the full writeup.
 */
const KNOWN_INTENTIONAL_SYNC_WRITES = new Set<string>([
  "recruitment/otp-verify-routes.ts:96",
]);

describe("F3 leftover hrms CQRS route boundary", () => {
  it("all module routes have zero sync Drizzle / repo writes (excluding disclosed exceptions above)", () => {
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      const src = readFileSync(file, "utf8");
      // Allow scopedRead((tx) => tx.execute(SELECT...)) analytics reads — only flag writes.
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/await\s+repo\.(?:insert|update|delete|create|save|upsert|attest|transition)\w*\s*\(/.test(line)) {
          offenders.push(`${file.replace(MODULES + "/", "")}:${i + 1}`);
          continue;
        }
        if (/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/.test(line) || /\bdb\.transaction\s*\(/.test(line)) {
          offenders.push(`${file.replace(MODULES + "/", "")}:${i + 1}`);
        }
      }
    }
    const unexpected = offenders.filter((o) => !KNOWN_INTENTIONAL_SYNC_WRITES.has(o));
    expect(unexpected).toEqual([]);

    // Guard against a stale allowlist entry (e.g. the line moved after a
    // refactor) silently hiding a *different* sync write that happens to
    // land on the same file:line.
    const stale = [...KNOWN_INTENTIONAL_SYNC_WRITES].filter((entry) => !offenders.includes(entry));
    expect(stale).toEqual([]);
  });

  it("leave cancel publishes via sendAccepted", () => {
    const src = readFileSync(join(MODULES, "leave/cancel-route.ts"), "utf8");
    expect(src).toContain("sendAccepted");
    expect(src).toContain("commands.cancelLeave");
    expect(src).not.toContain("db.transaction");
  });

  it("f3 leftover consumers are registered", () => {
    const worker = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");
    expect(worker).toContain("registerF3LeftoverAll");
    const topics = readFileSync(join(__dirname, "../src/topics.ts"), "utf8");
    expect(topics).toContain("f3RouteWrite");
    expect(topics).toContain("leaveCancel");
  });

  it("claims / disciplinary / service-book / rti residuals publish via queue", () => {
    const claims = readFileSync(join(MODULES, "claims/routes.ts"), "utf8");
    expect(claims).toContain('claims_routes__4');
    expect(claims).toContain('claims_routes__5');
    expect(claims).not.toMatch(/repo\.insertLtc|repo\.insertCea/);
    const disc = readFileSync(join(MODULES, "disciplinary/routes.ts"), "utf8");
    expect(disc).toContain("disciplinary_routes__3");
    expect(disc).not.toMatch(/repo\.insertSuspension/);
    const sb = readFileSync(join(MODULES, "service-book/routes.ts"), "utf8");
    expect(sb).not.toMatch(/repo\.updateEntryDescription|repo\.attestEntry/);
    const rti = readFileSync(join(MODULES, "rti/routes.ts"), "utf8");
    expect(rti).not.toMatch(/repo\.transitionRti/);
  });

  /**
   * pay-matrix annual-increment (fix/hrms-paymatrix-async-conversion): the
   * last 2 sites this guard test used to flag are now genuinely converted,
   * not just disclosed. routes.ts computes the exact per-employee increment
   * plan synchronously and forwards it verbatim via `pay_matrix_routes__0`;
   * f3-consumer.ts applies that plan exactly (never re-deriving a pay level
   * or re-walking PAY_MATRIX — that independent re-derivation is what made
   * the two earlier, reverted attempts at this conversion double-apply a
   * 7th-CPC increment). The double-submit race that a plain publish+consume
   * conversion would reopen (two concurrent requests both deciding to
   * increment the same employee before either consumer has written) is
   * closed at the DB layer by a partial unique index — see
   * migrations/0132_pay_matrix_increment_idempotency.sql and the
   * insert-first/conflict-checked write in f3-consumer.ts.
   */
  it("pay-matrix annual-increment forwards an exact plan; consumer applies it without re-deriving anything", () => {
    const routes = readFileSync(join(MODULES, "pay-matrix/routes.ts"), "utf8");
    expect(routes).toContain("pay_matrix_routes__0");
    expect(routes).toContain("plan");
    expect(routes).not.toMatch(SYNC_WRITE);

    const consumer = readFileSync(join(MODULES, "pay-matrix/f3-consumer.ts"), "utf8");
    expect(consumer).toContain("pay_matrix_routes__0");
    // Applies the precomputed toMinor verbatim...
    expect(consumer).toContain("BigInt(toMinor)");
    // ...and never re-derives a level from ENTRY_PAY_PAISE/basicMinor, which
    // is exactly what made the earlier reverted attempts double-apply.
    expect(consumer).not.toMatch(/ENTRY_PAY_PAISE/);
    // DB-layer idempotency: insert is conflict-checked before any pay write.
    expect(consumer).toContain("onConflictDoNothing");
  });
});
