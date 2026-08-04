/**
 * A command topic and an event topic must never share a string.
 *
 * `COMMANDS.runRecurringTask` and `EVENTS.recurringTaskRun` were both
 * "crm.recurring_task.run". The consumer subscribed to the command topic and
 * emitted the event onto the same topic, so it re-consumed its own completion
 * event as a fresh command. The event payload carries { taskId,
 * materialisedActionId } while the command handler reads { id, tenantId,
 * version }, so `p.id` was undefined and the guarded UPDATE rendered
 * `WHERE id =  AND tenant_id = ...` — SQLSTATE 42601. The throw rolled back
 * `markProcessed`, so the message was redelivered forever.
 *
 * Live symptoms before the fix: 155 messages backed up on
 * crm-recurring_task-run__crm-service, 37 dead-lettered, crm-worker at 2.6 GB
 * across 12 restarts.
 */
import { describe, it, expect } from "vitest";
import { COMMANDS, EVENTS } from "../src/topics.js";

describe("topic namespace integrity", () => {
  it("no COMMANDS value collides with any EVENTS value", () => {
    const commands = new Map<string, string>();
    for (const [name, topic] of Object.entries(COMMANDS)) {
      commands.set(topic as string, name);
    }

    const collisions: string[] = [];
    for (const [eventName, topic] of Object.entries(EVENTS)) {
      const commandName = commands.get(topic as string);
      if (commandName) {
        collisions.push(
          `"${topic}" is both COMMANDS.${commandName} and EVENTS.${eventName}`,
        );
      }
    }

    expect(collisions).toEqual([]);
  });

  it("the recurring-task run command and its completion event are distinct", () => {
    expect(EVENTS.recurringTaskRan).not.toBe(COMMANDS.runRecurringTask);
  });

  it("COMMANDS topics are unique among themselves", () => {
    const topics = Object.values(COMMANDS) as string[];
    expect(topics.length).toBe(new Set(topics).size);
  });

  it("EVENTS topics are unique among themselves", () => {
    const topics = Object.values(EVENTS) as string[];
    expect(topics.length).toBe(new Set(topics).size);
  });
});
