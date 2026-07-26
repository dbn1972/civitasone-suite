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
  allowlistIntegrityErrors,
} from "./cross-service-events.allowlist.js";

const STRICT = process.env.CONTRACT_STRICT === "1";

type Baseline = {
  counts: {
    deadSubscriptions: number;
    orphanEvents: number;
    undeclaredDeadSubscriptions?: number;
    undeliverableDispatch?: number;
    phantomConsumption: number;
    unemittedEvents: number;
  };
  deadSubscriptions: string[];
  undeclaredDeadSubscriptions?: string[];
  undeliverableDispatch?: string[];
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

// H1: a topic whose only declared producer never actually emits it is NOT a
// real producer. `effectiveProducers` is the set of topics some service both
// declares AND wires into code.
const unemittedByTopic = new Set<string>();
for (const c of contracts) {
  for (const ref of c.produced) {
    if (!isWired(c, ref, c.emittedInCode)) unemittedByTopic.add(ref.topic);
  }
}
function hasEffectiveProducer(topic: string): boolean {
  if (emitted.has(topic)) return true;
  const declared = producers.get(topic);
  if (!declared) return false;
  return !unemittedByTopic.has(topic);
}

// C1: keyed `service|topic`, not bare topic. Keying by topic alone let ANY
// service newly subscribe to any of the 22 baselined dead topics and stay green.
const deadSubscriptions: string[] = [];
for (const c of contracts) {
  for (const ref of c.consumed) {
    if (hasEffectiveProducer(ref.topic)) continue;
    if (isConsumerOnlyAllowed(ref.topic)) continue;
    deadSubscriptions.push(`${c.service}|${ref.topic}`);
  }
}

// C5: drive a check from ACTUAL subscribe() call sites, not just declarations.
// A typo'd literal at a real subscribe site was previously undetectable, and
// admin-service has live examples (admin.reconciliation.* with no publisher).
const ownTopics = new Map<string, Set<string>>();
for (const c of contracts) {
  ownTopics.set(
    c.service,
    new Set([...c.commands, ...c.produced].map((r) => r.topic)),
  );
}
const undeclaredDeadSubscriptions: string[] = [];
for (const c of contracts) {
  const own = ownTopics.get(c.service)!;
  for (const topic of c.subscribedInCode) {
    if (own.has(topic)) continue; // its own command/event — internal CQRS
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

  it("BLOCKING — no NEW dead subscriptions at real subscribe() call sites", () => {
    const New = regressions(
      undeclaredDeadSubscriptions,
      baseline.undeclaredDeadSubscriptions ?? [],
    );
    expect(
      New,
      `\n${New.length} NEW DEAD SUBSCRIPTION(S) AT A CALL SITE. Code calls subscribe() on a topic\n` +
        `no service effectively produces. Unlike the declaration check above, this catches a\n` +
        `typo'd literal passed directly to subscribe().\n${fmt(New)}\n`,
    ).toEqual([]);
  });

  it("BLOCKING — no NEW undeliverable command dispatch (cross-service write to an unhandled topic)", () => {
    // workflow-service DISPATCHes approval decisions into other services'
    // command namespaces (hrms.leave.approve, procurement.po.approve, ...).
    // If the target service does not declare AND subscribe to that command, the
    // approval is silently dropped — the maker-checker chain looks complete and
    // the downstream write never happens.
    const New = regressions(
      undeliverableDispatch,
      baseline.undeliverableDispatch ?? [],
    );
    expect(
      New,
      `\n${New.length} NEW UNDELIVERABLE DISPATCH(ES). A service publishes into another service's\n` +
        `command namespace, but the target neither declares nor subscribes to that topic —\n` +
        `the cross-service write is silently dropped.\n${fmt(New)}\n`,
    ).toEqual([]);
  });

  it("BLOCKING — every allowlist entry carries a categorised reason", () => {
    expect(
      allowlistIntegrityErrors(),
      "\nAllowlist entries must state WHY, using a documented category. " +
        "'It fails CI' is not a reason.\n",
    ).toEqual([]);
  });

  it("BLOCKING — every topic-shaped export is classified (no invisible contracts)", () => {
    // audit-service declared `CONSUME_TOPICS`, which matched none of the
    // recognised names, so its two live subscriptions — one of them dead — were
    // entirely outside this gate. An unclassified map is a silent blind spot.
    const bad: string[] = [];
    for (const c of contracts) {
      for (const name of c.unclassifiedMaps) {
        bad.push(
          `${c.service}: exported map "${name}" holds dotted topic strings but its name is not ` +
            `recognised as produced/command/consumed. Rename it to EVENTS / COMMANDS / ` +
            `CONSUMED_EVENTS, or add the name to the appropriate set in topic-registry.ts. ` +
            `Until then its topics are invisible to this gate.`,
        );
      }
      for (const name of c.unresolvedMaps) {
        bad.push(
          `${c.service}: recognised export "${name}" did not resolve to an object literal ` +
            `(re-export, spread, or unsupported expression). Its contract is invisible.`,
        );
      }
      for (const sk of c.skippedEntries) {
        bad.push(
          `${c.service}: ${sk.exportName}.${sk.key} has a non-string-literal value ` +
            `(template/computed/spread) and could not be read.`,
        );
      }
    }
    expect(bad, `\nInvisible contract declarations:\n${fmt(bad)}\n`).toEqual([]);
  });

  it("BLOCKING — baseline has no stale entries (a fixed defect cannot silently return)", () => {
    // Without this, a defect removed from the code stays in known-defects.json
    // forever and can be reintroduced for free.
    const stale: string[] = [];
    const check = (name: string, known: string[], current: string[]): void => {
      const cur = new Set(current);
      for (const k of known) if (!cur.has(k)) stale.push(`${name}: ${k}`);
    };
    check("deadSubscriptions", baseline.deadSubscriptions, deadSubscriptions);
    check("phantomConsumption", baseline.phantomConsumption, phantomConsumption);
    check("unemittedEvents", baseline.unemittedEvents, unemittedEvents);
    expect(
      stale,
      `\n${stale.length} STALE BASELINE ENTR(IES) — these defects are FIXED. Remove them so they\n` +
        `cannot be reintroduced for free:\n${fmt(stale)}\n\n` +
        `  pnpm contract:baseline\n`,
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
      undeclaredDeadSubscriptions: undeclaredDeadSubscriptions.length,
      undeliverableDispatch: undeliverableDispatch.length,
      phantomConsumption: phantomConsumption.length,
      unemittedEvents: unemittedEvents.length,
    };
    for (const key of Object.keys(current) as (keyof typeof current)[]) {
      expect(
        current[key],
        `${key} grew from ${baseline.counts[key] ?? 0} to ${current[key]}. ` +
          `The contract debt ratchet only moves down. Fix the regression, or if you\n` +
          `genuinely reduced it, regenerate the baseline:\n` +
          `  BASELINE_WRITE=1 npx vitest run tests/contract/lib/baseline.test.ts`,
      ).toBeLessThanOrEqual(baseline.counts[key] ?? 0);
    }
  });

  it("all topics follow the naming convention", () => {
    const bad: string[] = [];
    for (const c of contracts) {
      for (const ref of [...c.produced, ...c.commands, ...c.consumed]) {
        // Requires >=2 non-empty lowercase segments; rejects "a.", ".a", "a..b".
        if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(ref.topic)) {
          bad.push(
            `${c.service}: "${ref.topic}" must be lowercase {service}.{entity}.{action} ` +
              `with no empty segments`,
          );
        }
      }
    }
    expect(bad, `\nTopic naming violations:\n${fmt(bad)}\n`).toEqual([]);
  });

  it.runIf(STRICT)("STRICT — full inventory is clean (burn-down verification)", () => {
    expect({
      deadSubscriptions,
      undeclaredDeadSubscriptions,
      undeliverableDispatch,
      phantomConsumption,
      unemittedEvents,
      orphanEventCount: orphanEvents.length,
    }).toEqual({
      deadSubscriptions: [],
      undeclaredDeadSubscriptions: [],
      undeliverableDispatch: [],
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
