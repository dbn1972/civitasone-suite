/**
 * Consumer-driven cross-service event contract gate (Gate #3).
 *
 * WHAT THIS CATCHES — defect classes that were architecturally invisible before
 * this gate existed, because every service's own test suite passes in isolation:
 *
 *  1. DEAD SUBSCRIPTION — a service subscribes to `x.y.z` but no service in the
 *     fleet produces it. The handler never fires. Nothing errors. Silent.
 *  2. PHANTOM CONSUMPTION — CONSUMED_EVENTS declares a topic but no code in that
 *     service references it. The contract is documented, not implemented.
 *  3. UNEMITTED EVENT — EVENTS advertises a topic but no code references it.
 *     Consumers wired to it can never fire.
 *  4. ORPHAN EVENT — produced with no consumer ("publish-into-void"). Reported
 *     and ratcheted rather than hard-failed (see RATCHET below).
 *  5. TOPIC NAMING DRIFT — malformed or non-lowercase topic strings.
 *
 * HOW WIRING IS DETECTED: symbol-reference counting over the TypeScript AST, not
 * literal matching at call sites. Topic constants are routinely passed through
 * helpers (`emit(tx, msg, EVENTS.instanceCreated, ...)` → `enqueue({topic:
 * eventType})`), so literal matching produces false "never emitted" reports.
 *
 * RATCHET, NOT AMNESTY: `known-defects.json` records the defect counts that
 * existed when this gate was introduced. The gate FAILS if any count grows — you
 * cannot add a new dead subscription or new void. It does not pretend the
 * existing defects are acceptable; they are tracked debt and every one is listed
 * in QA-GATES.md with an owner. Run with CONTRACT_STRICT=1 to fail on the full
 * inventory (used to verify burn-down progress).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadContracts,
  producerIndex,
  consumerIndex,
  emittedAnywhere,
  isWired,
  type ServiceContract,
} from "./lib/topic-registry.js";
import {
  isProducerOnlyAllowed,
  isConsumerOnlyAllowed,
} from "./cross-service-events.allowlist.js";

const STRICT = process.env.CONTRACT_STRICT === "1";

type Baseline = {
  counts: {
    deadSubscriptions: number;
    orphanEvents: number;
    phantomConsumption: number;
    unemittedEvents: number;
  };
  deadSubscriptions: string[];
  orphanEvents: string[];
  phantomConsumption: string[];
  unemittedEvents: string[];
};

const baseline: Baseline = JSON.parse(
  readFileSync(join(process.cwd(), "tests/contract/known-defects.json"), "utf8"),
);

const contracts = loadContracts();
const producers = producerIndex(contracts);
const consumers = consumerIndex(contracts);
const emitted = emittedAnywhere(contracts);

// ── Compute the current inventory ────────────────────────────────────────────

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

/** Items present now that were not in the baseline — always a hard failure. */
function regressions(current: string[], known: string[]): string[] {
  const knownSet = new Set(known);
  return current.filter((x) => !knownSet.has(x)).sort();
}

function fmt(items: string[]): string {
  return items.map((x) => `    ${x}`).join("\n");
}

// ── Gate ─────────────────────────────────────────────────────────────────────

describe("cross-service event contract", () => {
  it("discovers a topic registry for every service that declares one", () => {
    expect(contracts.length).toBeGreaterThanOrEqual(38);
    for (const c of contracts) {
      const total = c.produced.length + c.commands.length + c.consumed.length;
      expect(total, `${c.service}/src/topics.ts declares no topics`).toBeGreaterThan(0);
    }
  });

  it("BLOCKING — no NEW dead subscriptions (consumer wired to a topic nobody emits)", () => {
    const New = regressions(deadSubscriptions, baseline.deadSubscriptions);
    expect(
      New,
      `\n${New.length} NEW DEAD SUBSCRIPTION(S). A consumer is wired to a topic no service produces —\n` +
        `the handler will never fire and nothing will error.\n${fmt(New)}\n\n` +
        `Fix by: correcting the topic string, adding the producer, or (only if an external\n` +
        `system publishes it) documenting it in CONSUMER_ONLY_ALLOWLIST with a reason.\n`,
    ).toEqual([]);
  });

  it("BLOCKING — no NEW phantom consumption (declared consumed, not implemented)", () => {
    const New = regressions(phantomConsumption, baseline.phantomConsumption);
    expect(
      New,
      `\n${New.length} NEW PHANTOM CONSUMPTION(S). CONSUMED_EVENTS declares a contract that no\n` +
        `code in the service references, so the documented integration does not exist.\n${fmt(New)}\n\n` +
        `Fix by: implementing the consumer, or removing the declaration.\n`,
    ).toEqual([]);
  });

  it("BLOCKING — no NEW unemitted events (advertised in EVENTS, never published)", () => {
    const New = regressions(unemittedEvents, baseline.unemittedEvents);
    expect(
      New,
      `\n${New.length} NEW UNEMITTED EVENT(S). EVENTS advertises a topic to consumers that no\n` +
        `code in the producing service ever publishes.\n${fmt(New)}\n\n` +
        `Fix by: emitting it via the outbox, or removing it from EVENTS.\n`,
    ).toEqual([]);
  });

  it("BLOCKING — no NEW orphan events (produced into the void)", () => {
    const New = regressions(orphanEvents, baseline.orphanEvents);
    expect(
      New,
      `\n${New.length} NEW ORPHAN EVENT(S). Produced but no service consumes it — if a downstream\n` +
        `effect is expected, the consumer is missing (publish-into-void façade).\n${fmt(New)}\n\n` +
        `Fix by: adding the consumer, or documenting it in PRODUCER_ONLY_ALLOWLIST if terminal.\n`,
    ).toEqual([]);
  });

  it("BLOCKING — defect counts never increase (ratchet)", () => {
    const current = {
      deadSubscriptions: deadSubscriptions.length,
      orphanEvents: orphanEvents.length,
      phantomConsumption: phantomConsumption.length,
      unemittedEvents: unemittedEvents.length,
    };
    for (const key of Object.keys(current) as (keyof typeof current)[]) {
      expect(
        current[key],
        `${key} grew from ${baseline.counts[key]} to ${current[key]}. ` +
          `The contract debt ratchet only moves down. Fix the regression, or if you\n` +
          `genuinely reduced it, regenerate the baseline:\n` +
          `  BASELINE_WRITE=1 npx vitest run tests/contract/lib/baseline.test.ts`,
      ).toBeLessThanOrEqual(baseline.counts[key]);
    }
  });

  it("all topics follow the naming convention", () => {
    const bad: string[] = [];
    for (const c of contracts) {
      for (const ref of [...c.produced, ...c.commands, ...c.consumed]) {
        if (ref.topic.split(".").length < 2) {
          bad.push(`${c.service}: "${ref.topic}" has fewer than 2 segments`);
        }
        if (!/^[a-z0-9_.-]+$/.test(ref.topic)) {
          bad.push(`${c.service}: "${ref.topic}" has invalid characters (must be lowercase)`);
        }
      }
    }
    expect(bad, `\nTopic naming violations:\n${fmt(bad)}\n`).toEqual([]);
  });

  it.runIf(STRICT)("STRICT — full inventory is clean (burn-down verification)", () => {
    expect({
      deadSubscriptions,
      phantomConsumption,
      unemittedEvents,
      orphanEventCount: orphanEvents.length,
    }).toEqual({
      deadSubscriptions: [],
      phantomConsumption: [],
      unemittedEvents: [],
      orphanEventCount: 0,
    });
  });
});

// ── Per-service breakdown so a failure names the owning team ─────────────────

describe("cross-service event contract — per service", () => {
  const byService = (list: string[], svc: string): string[] =>
    list.filter((x) => x.startsWith(`${svc}|`));

  for (const c of contracts) {
    describe(c.service, () => {
      it("introduces no new phantom consumption", () => {
        const New = regressions(
          byService(phantomConsumption, c.service),
          byService(baseline.phantomConsumption, c.service),
        );
        expect(New, `${c.service} declares consumption it does not implement`).toEqual([]);
      });

      it("introduces no new unemitted events", () => {
        const New = regressions(
          byService(unemittedEvents, c.service),
          byService(baseline.unemittedEvents, c.service),
        );
        expect(New, `${c.service} advertises events it never publishes`).toEqual([]);
      });
    });
  }
});
