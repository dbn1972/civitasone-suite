import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
}));

import { createCalendar, updateCalendar } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): calendarCreate used randomUUID() as the calendar id AND messageId;
 * calendarUpdate then used the calendar id as its messageId, which was already in the inbox -> every
 * calendar update was dropped.
 */
describe("helpdesk calendar commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("create then update then update again: three distinct messageIds, no update reuses the calendar id", async () => {
    const created = await createCalendar(ctx, { name: "c", timezone: "Asia/Kolkata", workDays: [], holidays: [] });
    await updateCalendar(ctx, created.id, { name: "c2", expectedVersion: 1 });
    await updateCalendar(ctx, created.id, { name: "c3", expectedVersion: 2 });
    const ids = published.map((p) => p.messageId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).not.toBe(created.id);
    expect(ids[2]).not.toBe(created.id);
  });
});
