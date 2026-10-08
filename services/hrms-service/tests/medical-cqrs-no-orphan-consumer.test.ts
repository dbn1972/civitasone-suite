/**
 * GAP2-HRMS-MEDICAL-02 guard.
 *
 * The medical module subscribes to COMMANDS.medicalClaimCreate and
 * COMMANDS.medicalClaimApprove. Before the fix those two subscriptions were
 * DEAD code — no code path anywhere in the service published either topic
 * (the routes did the writes inline and published nothing), which read as if
 * medical claims used the CQRS write path when they do not. This guard
 * asserts that each of those two subscribed command topics has at least one
 * matching `queue.publish(COMMANDS.<topic>)` somewhere in the service source.
 *
 * Scoped deliberately to the medical topics this finding concerns: many other
 * hrms command topics are published through indirect helpers (pub()/the
 * generic command bus) rather than a literal `queue.publish(COMMANDS.x)`
 * call, so a service-wide literal-match assertion would raise unrelated,
 * out-of-scope false positives. This test FAILS on the old code (neither
 * topic was published from the routes) and PASSES after the routes publish
 * their precise audit commands.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src");

function tsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts")) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

const SUBSCRIBED_MEDICAL_TOPICS = ["medicalClaimCreate", "medicalClaimApprove"] as const;

describe("GAP2-HRMS-MEDICAL-02 — no orphaned medical queue.subscribe", () => {
  const sources = tsFiles().map((f) => readFileSync(f, "utf8"));
  const all = sources.join("\n");

  for (const topic of SUBSCRIBED_MEDICAL_TOPICS) {
    it(`COMMANDS.${topic} is both subscribed and published`, () => {
      const subscribeRe = new RegExp(`subscribe\\(\\s*COMMANDS\\.${topic}\\b`);
      const publishRe = new RegExp(`publish\\(\\s*COMMANDS\\.${topic}\\b`);

      // Precondition: the subscription exists (it always has).
      expect(all).toMatch(subscribeRe);

      // The fix: a matching publish must now exist (fails on old code).
      expect(all, `COMMANDS.${topic} is subscribed but never published — orphaned consumer`).toMatch(publishRe);
    });
  }
});
