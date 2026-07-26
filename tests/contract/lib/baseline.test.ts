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

    const unemittedByTopic = new Set<string>();
    for (const c of contracts) {
      for (const ref of c.produced) {
        if (!isWired(c, ref, c.emittedInCode)) unemittedByTopic.add(ref.topic);
      }
    }
    const hasEffectiveProducer = (topic: string): boolean => {
      if (emitted.has(topic)) return true;
      if (!producers.get(topic)) return false;
      return !unemittedByTopic.has(topic);
    };

    const deadSubscriptions: string[] = [];
    for (const c of contracts) {
      for (const ref of c.consumed) {
        if (hasEffectiveProducer(ref.topic)) continue;
        if (isConsumerOnlyAllowed(ref.topic)) continue;
        deadSubscriptions.push(`${c.service}|${ref.topic}`);
      }
    }

    const ownTopics = new Map<string, Set<string>>();
    for (const c of contracts) {
      ownTopics.set(c.service, new Set([...c.commands, ...c.produced].map((r) => r.topic)));
    }
    const undeclaredDeadSubscriptions: string[] = [];
    for (const c of contracts) {
      const own = ownTopics.get(c.service)!;
      for (const topic of c.subscribedInCode) {
        if (own.has(topic)) continue;
        if (hasEffectiveProducer(topic)) continue;
        if (isConsumerOnlyAllowed(topic)) continue;
        undeclaredDeadSubscriptions.push(`${c.service}|${topic}`);
      }
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
        if (!isWired(c, ref, c.subscribedInCode)) {
          phantomConsumption.push(`${c.service}|${ref.topic}`);
        }
      }
      for (const ref of c.produced) {
        if (!isWired(c, ref, c.emittedInCode)) {
          unemittedEvents.push(`${c.service}|${ref.topic}`);
        }
      }
    }


    // Cross-service command dispatch: a topic published into ANOTHER service's
    // namespace must be handled by that service (declared in its COMMANDS/consumed
    // AND subscribed in its code), otherwise the write is silently dropped.
    const handledByService = new Map<string, Set<string>>();
    for (const c of contracts) {
      const handled = new Set<string>();
      for (const r of [...c.commands, ...c.consumed]) handled.add(r.topic);
      for (const t of c.subscribedInCode) handled.add(t);
      handledByService.set(c.service, handled);
    }
    function isHandledAnywhere(topic: string): boolean {
      for (const handled of handledByService.values()) {
        if (handled.has(topic)) return true;
      }
      return false;
    }
    const undeliverableDispatch: string[] = [];
    for (const c of contracts) {
      for (const ref of c.dispatched) {
        if (isHandledAnywhere(ref.topic)) continue;
        if (isConsumerOnlyAllowed(ref.topic)) continue;
        undeliverableDispatch.push(`${c.service}|${ref.topic}`);
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
        undeclaredDeadSubscriptions: undeclaredDeadSubscriptions.length,
        undeliverableDispatch: undeliverableDispatch.length,
        orphanEvents: orphanEvents.length,
        phantomConsumption: phantomConsumption.length,
        unemittedEvents: unemittedEvents.length,
      },
      deadSubscriptions: deadSubscriptions.sort(),
      undeclaredDeadSubscriptions: undeclaredDeadSubscriptions.sort(),
      undeliverableDispatch: undeliverableDispatch.sort(),
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
