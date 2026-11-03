/**
 * #2452 review nit: the meeting-core publish helpers stamp the verified token roles (ctx.roles)
 * as payload.actorRoles AFTER the validated body, so an actorRoles field in a request body can
 * never reach the consumer admin bypass. Exercised directly on the helpers (the route test in
 * meeting-lifecycle-admin-consumer-j14 is refused earlier, for lack of standing).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import type { CommandEnvelope, MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { publishMeetingTransition, publishMeetingUpdate, publishMeetingCancel } from "../src/modules/meeting-core/commands.js";

afterAll(async () => { await sqlClient.end(); });

const published = new Map<string, CommandEnvelope<Record<string, unknown>>[]>();
for (const topic of [COMMANDS.meetingTransition, COMMANDS.meetingUpdate, COMMANDS.meetingCancel]) {
  published.set(topic, []);
  queue.subscribe(topic, async (m: CommandEnvelope) => { published.get(topic)!.push(m as CommandEnvelope<Record<string, unknown>>); });
}
const drain = () => (queue as unknown as MemoryQueue).drain();

const ctx = (roles: string[]): RequestContext => ({
  tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles, correlationId: randomUUID(),
}) as RequestContext;

const SMUGGLED = { actorRoles: ["super_admin", "meeting_admin"] };

describe("meeting-core publish helpers: actorRoles always comes from the token", () => {
  it("publishMeetingTransition overwrites a body actorRoles with ctx.roles", async () => {
    const c = ctx(["committee_chairperson"]);
    const id = randomUUID();
    await publishMeetingTransition(c, id, { version: 1, to: "scheduled", ...SMUGGLED } as never);
    await drain();
    const m = published.get(COMMANDS.meetingTransition)!.find((x) => x.payload.meetingId === id)!;
    expect(m.payload.actorRoles).toEqual(["committee_chairperson"]);
    expect(m.actorId).toBe(c.actorId);
  });

  it("publishMeetingUpdate stamps ctx.roles even when the patch carries actorRoles", async () => {
    const c = ctx(["committee_secretary"]);
    const id = randomUUID();
    await publishMeetingUpdate(c, id, 3, { venue: "Hall A", ...SMUGGLED } as never);
    await drain();
    const m = published.get(COMMANDS.meetingUpdate)!.find((x) => x.payload.meetingId === id)!;
    expect(m.payload.actorRoles).toEqual(["committee_secretary"]);
  });

  it("publishMeetingCancel overwrites a body actorRoles with ctx.roles", async () => {
    const c = ctx([]);
    const id = randomUUID();
    await publishMeetingCancel(c, id, { version: 2, reason: "Rescheduled", ...SMUGGLED } as never);
    await drain();
    const m = published.get(COMMANDS.meetingCancel)!.find((x) => x.payload.meetingId === id)!;
    expect(m.payload.actorRoles).toEqual([]);
  });
});
