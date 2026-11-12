/** Meetings -> cross-module search (real DB): only public/internal meetings are indexed; confidential ones are removed. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { meetings } from "../src/modules/meeting-core/schema.js";
import { syncMeeting } from "../src/shared/global-search.js";

const T = "99999999-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));
const run = randomUUID().slice(0, 8);

async function seed(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  await scoped(async (tx) => {
    await tx.insert(meetings).values({
      id, tenantId: T, type: "committee", title: "Budget review", description: "SECRET AGENDA TEXT", venue: "Room 7", meetingNumber: `MTG-${run}-${id.slice(0, 4)}`,
      scheduledAt: new Date("2026-12-01T10:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR, ...over,
    });
    await syncMeeting(tx, id, T);
  });
  return id;
}

describe("meetings -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => {
    await wipe();
    await scoped((tx) => tx.delete(meetings).where(eq(meetings.tenantId, T))).catch(() => undefined);
    await sqlClient.end();
  });

  it("flag off: no event", async () => {
    await seed();
    expect(await events()).toEqual([]);
  });
  it("flag on: title, number, status, type and date; no description or venue", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    await seed();
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ action: "upsert", entityType: "meeting.meeting", module: "meeting", name: "Budget review", status: "draft", description: "committee · 2026-12-01" });
    expect(JSON.stringify(ev)).not.toMatch(/SECRET AGENDA|Room 7/);
  });
  it("personal data typed into a meeting title is redacted before it reaches the event", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    await seed({ title: "Review for ABCDE-1234-F, call 98765 43210, acct 123456789012" });
    const wire = JSON.stringify(await events());
    expect(wire).not.toMatch(/ABCDE|98765|123456789012/);
    expect(wire).toContain("[redacted]");
  });
  it("confidential, secret and top-secret meetings are removed rather than indexed; a meeting that becomes confidential is removed", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    for (const level of ["confidential", "secret", "top_secret"]) await seed({ confidentialityLevel: level });
    const id = await seed({ confidentialityLevel: "internal" });
    await scoped(async (tx) => { await tx.update(meetings).set({ confidentialityLevel: "confidential" }).where(eq(meetings.id, id)); await syncMeeting(tx, id, T); });
    expect((await events()).map((e) => e.payload.action)).toEqual(["delete", "delete", "delete", "upsert", "delete"]);
  });
});
