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
});
