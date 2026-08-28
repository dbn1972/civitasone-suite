import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");
const TARGETS = [
  "api-keys/routes.ts",
  "change/routes.ts",
  "sandbox/routes.ts",
  "central-config/routes.ts",
  "config/artefact-routes.ts",
  "health/mobile-routes.ts",
  "dept-templates/routes.ts",
  "integration-settings/routes.ts",
  "uploads/doc-routes.ts",
  "support/routes.ts",
  "integration-ops/routes.ts",
];

describe("F3 P0 leftover admin CQRS", () => {
  it("target routes have zero await db.transaction writes and no 201", () => {
    const offenders: string[] = [];
    for (const rel of TARGETS) {
      const src = readFileSync(join(MODULES, rel), "utf8");
      if (/await\s+db\.transaction/.test(src) || /reply\.code\(201\)/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("api-keys and mobile publish commands", () => {
    const keys = readFileSync(join(MODULES, "api-keys/routes.ts"), "utf8");
    const mobile = readFileSync(join(MODULES, "health/mobile-routes.ts"), "utf8");
    expect(keys).toContain("commands.createApiKey");
    expect(keys).toContain("code(202)");
    expect(mobile).toContain("commands.recordMobileTelemetry");
  });

  it("f3 consumers markProcessed before writes", () => {
    const change = readFileSync(join(MODULES, "change/f3-consumer.ts"), "utf8");
    expect(change).toContain("markProcessed");
    expect(change).toContain("COMMANDS.f3RouteWrite");
  });

  // Regression guard for the SoD-adjacent bug fixed alongside PR #823: these five
  // consumers used to claim inbox idempotency (markProcessed) in its own
  // transaction BEFORE dispatching to apply_*_N(), so a thrown business error
  // (a MAKER_CHECKER_VIOLATION self-approval attempt, NOT_PENDING,
  // VERSION_CONFLICT, ...) rolled back the mutation but left the message
  // permanently marked processed — SQS's redelivery then found it pre-claimed,
  // returned with no exception, and SQS deleted it as an ordinary success. The
  // action silently never happened, was never retried, and never reached the
  // dead-letter queue. The fix claims the message only AFTER the dispatch
  // succeeds. The title above is intentionally kept (grep-compatible with prior
  // history) even though it now describes the OLD, buggy behaviour — this test
  // is what actually asserts the current, correct ordering.
  it("f3 consumers claim markProcessed only AFTER the dispatch succeeds, not before", () => {
    const consumers = [
      "central-config/f3-consumer.ts",
      "change/f3-consumer.ts",
      "config/artefact-f3-consumer.ts",
      "integration-settings/f3-consumer.ts",
      "sandbox/f3-consumer.ts",
    ];
    const offenders: string[] = [];
    for (const rel of consumers) {
      const src = readFileSync(join(MODULES, rel), "utf8");
      const lastApplyCallEnd = src.lastIndexOf("await apply_");
      const claimCallStart = src.indexOf("await db.transaction(async (tx) => { await markProcessed(tx, msg.messageId); });");
      if (lastApplyCallEnd === -1 || claimCallStart === -1 || claimCallStart < lastApplyCallEnd) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
