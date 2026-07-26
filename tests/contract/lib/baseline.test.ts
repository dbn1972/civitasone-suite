/**
 * Baseline generator (not a gate). Writes the current defect inventory to
 * tests/contract/known-defects.json so the contract gate can ratchet on it.
 *
 * Run: BASELINE_WRITE=1 npx vitest run tests/contract/lib/baseline.test.ts
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadContracts,
  producerIndex,
  consumerIndex,
  emittedAnywhere,
  isWired,
} from "./topic-registry.js";
import { isProducerOnlyAllowed, isConsumerOnlyAllowed } from "../cross-service-events.allowlist.js";

describe("contract baseline", () => {
  it("writes the current defect inventory", () => {
    const contracts = loadContracts();
    const producers = producerIndex(contracts);
    const consumers = consumerIndex(contracts);
    const emitted = emittedAnywhere(contracts);

    const deadSubscriptions: string[] = [];
    for (const [topic] of consumers) {
      if (producers.has(topic) || emitted.has(topic)) continue;
      if (isConsumerOnlyAllowed(topic)) continue;
      deadSubscriptions.push(topic);
    }

    const orphanEvents: string[] = [];
    for (const [topic] of producers) {
      if (consumers.has(topic)) continue;
      if (isProducerOnlyAllowed(topic)) continue;
      orphanEvents.push(topic);
    }

    const phantomConsumption: string[] = [];
    const unemittedEvents: string[] = [];
    for (const c of contracts) {
      for (const ref of c.consumed) {
        if (!isWired(c, c.consumedMapName, ref, c.subscribedInCode)) {
          phantomConsumption.push(`${c.service}|${ref.topic}`);
        }
      }
      for (const ref of c.produced) {
        if (!isWired(c, c.producedMapName, ref, c.emittedInCode)) {
          unemittedEvents.push(`${c.service}|${ref.topic}`);
        }
      }
    }

    const baseline = {
      $comment:
        "GENERATED DEFECT BASELINE — these are KNOWN DEFECTS, not approved exceptions. " +
        "The contract gate fails if any count grows. Burn these down; never add to them. " +
        "Regenerate with: BASELINE_WRITE=1 npx vitest run tests/contract/lib/baseline.test.ts",
      generatedAt: new Date().toISOString().slice(0, 10),
      counts: {
        deadSubscriptions: deadSubscriptions.length,
        orphanEvents: orphanEvents.length,
        phantomConsumption: phantomConsumption.length,
        unemittedEvents: unemittedEvents.length,
      },
      deadSubscriptions: deadSubscriptions.sort(),
      orphanEvents: orphanEvents.sort(),
      phantomConsumption: phantomConsumption.sort(),
      unemittedEvents: unemittedEvents.sort(),
    };

    const out = join(process.cwd(), "tests/contract/known-defects.json");
    if (process.env.BASELINE_WRITE === "1") {
      writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`Wrote ${out}`);
    }
    console.log(JSON.stringify(baseline.counts, null, 2));
  });
});
