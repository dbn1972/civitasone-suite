/**
 * worker.ts consumer-wiring smoke test (task 19.1).
 *
 * worker.ts itself has top-level bootstrap side effects (assertPiiKeyConfigured,
 * `await queue.start()`, outbox relay, schedulers) that make importing the module
 * directly impractical for a unit test. Instead this test mirrors worker.ts's
 * `MODULE_REGISTRARS` list exactly and drives every registrar through the SAME
 * strict `registerConsumer` contract worker.ts uses (throw-on-duplicate). It
 * proves the invariant worker.ts relies on at boot:
 *
 *   • no two modules claim the same topic (a collision would crash the worker);
 *   • every CONSUMED_EVENTS topic (cross-service facts) has a handler;
 *   • every registered topic is a real, declared topic constant (no typos / strays).
 *
 * If a new module registrar is added to worker.ts, add it to `MODULE_REGISTRARS`
 * below too — the "no stray topics" + "duplicate guard" assertions keep the two
 * lists honest.
 */
import { describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@civitasone/queue";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { registerMinutesConsumers } from "../src/modules/minutes/consumer.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";
import { registerActionItemConsumers } from "../src/modules/action-item/consumer.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";
import { registerVcConsumers } from "../src/modules/vc-integration/consumer.js";
import { registerCalendarConsumers } from "../src/modules/calendar/consumer.js";
import { registerDocumentConsumers } from "../src/modules/document/consumer.js";
import { registerAiAssistConsumers } from "../src/modules/ai-assist/consumer.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";

type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;
type ModuleRegistrar = (register: RegisterConsumer) => void;

/** Mirrors worker.ts MODULE_REGISTRARS (domain command consumers + cross-service consumed events). */
const MODULE_REGISTRARS: ModuleRegistrar[] = [
  registerMeetingCoreConsumers,
  registerCommitteeConsumers,
  registerAgendaConsumers,
  registerParticipantConsumers,
  registerAttendanceConsumers,
  registerMinutesConsumers,
  registerDecisionConsumers,
  registerActionItemConsumers,
  registerVotingConsumers,
  registerVcConsumers,
  registerCalendarConsumers,
  registerDocumentConsumers,
  registerAiAssistConsumers,
  registerIntegrationConsumers,
];

/** Faithful copy of worker.ts's throw-on-duplicate `registerConsumer`. */
function buildRegistry(): Map<string, ConsumerHandler> {
  const registry = new Map<string, ConsumerHandler>();
  const register: RegisterConsumer = (topic, handler) => {
    if (registry.has(topic)) {
      throw new Error(`meeting-worker: duplicate consumer registration for "${topic}"`);
    }
    registry.set(topic, handler as ConsumerHandler);
  };
  for (const registrar of MODULE_REGISTRARS) registrar(register);
  return registry;
}

const ALL_TOPICS = new Set<string>([...Object.values(COMMANDS), ...Object.values(CONSUMED_EVENTS)]);

describe("worker consumer wiring (task 19.1)", () => {
  it("registers all module + integration consumers without any duplicate-topic collision", () => {
    expect(() => buildRegistry()).not.toThrow();
  });

  it("wires every cross-service CONSUMED_EVENTS topic to a handler", () => {
    const registry = buildRegistry();
    for (const topic of Object.values(CONSUMED_EVENTS)) {
      expect(registry.has(topic), `missing handler for consumed event "${topic}"`).toBe(true);
    }
  });

  it("registers only declared topic constants (no typos or stray topics)", () => {
    const registry = buildRegistry();
    for (const topic of registry.keys()) {
      expect(ALL_TOPICS.has(topic), `unknown topic registered: "${topic}"`).toBe(true);
    }
  });

  it("covers the core write-side command topics", () => {
    const registry = buildRegistry();
    // A representative topic from each domain module confirms its registrar ran.
    const expected = [
      COMMANDS.meetingCreate,
      COMMANDS.committeeCreate,
      COMMANDS.agendaItemSubmit,
      COMMANDS.participantAdd,
      COMMANDS.attendanceCheckIn,
      COMMANDS.minutesCreate,
      COMMANDS.decisionRecord,
      COMMANDS.actionItemAssign,
      COMMANDS.voteInitiate,
      COMMANDS.vcSessionCreate,
      COMMANDS.roomCreate,
      COMMANDS.documentUpload,
      COMMANDS.aiTranscribe,
    ];
    for (const topic of expected) {
      expect(registry.has(topic), `missing handler for command "${topic}"`).toBe(true);
    }
  });

  it("re-running the same registrars over one registry trips the duplicate guard", () => {
    const registry = buildRegistry();
    const register: RegisterConsumer = (topic, handler) => {
      if (registry.has(topic)) {
        throw new Error(`meeting-worker: duplicate consumer registration for "${topic}"`);
      }
      registry.set(topic, handler as ConsumerHandler);
    };
    expect(() => registerMeetingCoreConsumers(register)).toThrow(/duplicate consumer registration/);
  });
});
