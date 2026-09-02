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

describe("F3 leftover hrms CQRS route boundary", () => {
  it("all module routes have zero sync Drizzle / repo writes", () => {
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
    expect(offenders).toEqual([]);
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
