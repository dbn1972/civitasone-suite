/**
 * HRMS module profile — unit + consumer-registration tests (ST-M01-04).
 *
 * Proves the HRMS_MODULES allow-list semantics and, critically, that the
 * core-only profile subscribes ONLY core consumers — asserted against the
 * REAL worker registration (`registerConsumers`, the same function worker.ts
 * calls), using a recording fake queue so no broker/DB is needed.
 *
 * Spec: SMARTTRANSFER-MASTER-SPEC-v3 §3, §11; D-ST-23.
 */
import { describe, it, expect } from "vitest";
import type { Queue } from "@civitasone/queue";
import {
  parseEnabledNonCore,
  loadModuleProfile,
  NON_CORE_MODULES,
  ModuleProfileError,
} from "../shared/module-profile.js";
import { registerConsumers } from "../consumers.js";

/** A fake queue that records every subscribed topic (no broker, no DB). */
function recordingQueue(): { queue: Queue; topics: string[] } {
  const topics: string[] = [];
  const queue = {
    subscribe: (topic: string, _handler: unknown) => {
      topics.push(topic);
    },
    publish: async () => {},
    start: async () => {},
    stop: async () => {},
  } as unknown as Queue;
  return { queue, topics };
}

/**
 * Topic substrings that only a NON-CORE module's consumer would subscribe.
 *
 * NOTE two legitimate CORE cross-domain subscriptions are intentionally NOT in
 * this list:
 *   • `hrms.internal.payroll_snapshot` — the CORE internal consumer exposes the
 *     payroll INPUT snapshot (a cross-service surface payroll reads); it is not
 *     payroll business logic and stays on in Workforce Core.
 *   • `hrms.recruitment.position_filled` — the CORE manpower consumer (SVC-003
 *     fill-loop) reacts to a recruitment event to update sanctioned-post plans;
 *     manpower is Workforce Core.
 * So markers below use the owning module's own command/event namespace, which
 * only that non-core module subscribes.
 */
const NON_CORE_TOPIC_MARKERS = [
  "leave.",
  "attendance.",
  "candidate.",
  "appraisal.",
  "apar.",
  "pension.",
  ".gpf",
  ".nps",
  ".cpf",
  "loan.",
  "claim.",
  "medical.",
  "training.",
  "learning.",
  "disciplinary.",
  "grievance.",
  "deputation.",
  "contract.",
  "assessment.",
  "id_card",
  "id-card",
  "device.",
  "rti.",
];

describe("parseEnabledNonCore", () => {
  it("unset => all non-core modules enabled (no regression)", () => {
    const s = parseEnabledNonCore(undefined);
    expect(s.size).toBe(NON_CORE_MODULES.length);
    for (const m of NON_CORE_MODULES) expect(s.has(m)).toBe(true);
  });

  it("blank/whitespace => all non-core modules enabled", () => {
    expect(parseEnabledNonCore("   ").size).toBe(NON_CORE_MODULES.length);
  });

  it('"core" => no non-core modules', () => {
    expect(parseEnabledNonCore("core").size).toBe(0);
  });

  it('"core,leave,payroll_facing" => exactly those non-core modules', () => {
    const s = parseEnabledNonCore("core,leave,payroll_facing");
    expect([...s].sort()).toEqual(["leave", "payroll_facing"]);
  });

  it("is case-insensitive and trims", () => {
    const s = parseEnabledNonCore(" CORE , Leave ");
    expect([...s]).toEqual(["leave"]);
  });

  it("throws on an unknown module name (fail fast, never silently widen/narrow)", () => {
    expect(() => parseEnabledNonCore("core,nonsense")).toThrow(ModuleProfileError);
  });
});

describe("loadModuleProfile", () => {
  it("unset => allModules, not coreOnly", () => {
    const p = loadModuleProfile(undefined);
    expect(p.allModules).toBe(true);
    expect(p.coreOnly).toBe(false);
    expect(p.isCoreAlwaysOn()).toBe(true);
  });

  it('"core" => coreOnly, not allModules', () => {
    const p = loadModuleProfile("core");
    expect(p.coreOnly).toBe(true);
    expect(p.allModules).toBe(false);
    expect(p.isNonCoreEnabled("leave")).toBe(false);
  });

  it('"core,leave" => leave on, payroll_facing off', () => {
    const p = loadModuleProfile("core,leave");
    expect(p.coreOnly).toBe(false);
    expect(p.isNonCoreEnabled("leave")).toBe(true);
    expect(p.isNonCoreEnabled("payroll_facing")).toBe(false);
  });
});

describe("registerConsumers — core-only profile subscribes core consumers only", () => {
  it("default (all) subscribes markedly more topics than core-only", () => {
    const all = recordingQueue();
    registerConsumers(all.queue, loadModuleProfile(undefined));

    const core = recordingQueue();
    registerConsumers(core.queue, loadModuleProfile("core"));

    expect(all.topics.length).toBeGreaterThan(core.topics.length);
    // Core-only still subscribes at least the employee/lifecycle core set.
    expect(core.topics.length).toBeGreaterThan(0);
  });

  it("core-only subscribes NO topic that names a non-core domain", () => {
    const core = recordingQueue();
    registerConsumers(core.queue, loadModuleProfile("core"));

    const offenders = core.topics.filter((t) =>
      NON_CORE_TOPIC_MARKERS.some((marker) => t.toLowerCase().includes(marker)),
    );
    expect(offenders).toEqual([]);
  });

  it("enabling leave re-subscribes leave consumers (and only when enabled)", () => {
    const withoutLeave = recordingQueue();
    registerConsumers(withoutLeave.queue, loadModuleProfile("core"));
    const leaveTopicsCoreOnly = withoutLeave.topics.filter((t) => t.toLowerCase().includes("leave"));
    expect(leaveTopicsCoreOnly).toEqual([]);

    const withLeave = recordingQueue();
    registerConsumers(withLeave.queue, loadModuleProfile("core,leave"));
    const leaveTopicsEnabled = withLeave.topics.filter((t) => t.toLowerCase().includes("leave"));
    expect(leaveTopicsEnabled.length).toBeGreaterThan(0);
  });
});
