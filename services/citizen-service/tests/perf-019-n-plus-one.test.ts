/**
 * PERF-019 regression test — citizen-service tranche.
 *
 * Covers the 1 citizen-service site named in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-019 row:
 *   - helpdesk/queries.ts::listTicketDetails (was N+1 via listNotes per row)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook), only counting
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005 tranche 1's
 * perf-005-n-plus-one.test.ts files exactly. The primary assertion is
 * O(1)-not-O(N): the same function issues the SAME query count for a small
 * (3-ticket) tenant and a large (20-ticket) one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { citizenTickets, citizenTicketNotes } from "../src/modules/helpdesk/schema.js";
import { listTicketDetails } from "../src/modules/helpdesk/queries.js";

const ACTOR = "90000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function seed(tenant: string, n: number) {
  const citizenId = randomUUID();
  const tickets = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, citizenId, ticketNo: `PERF019-T-${i}`,
    subject: `Ticket ${i}`, description: `Description ${i}`, status: "open",
    priority: "medium", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // 2 notes per ticket, so a broken batch loader (or one that drops notes for
  // any ticket) would be visible in the per-ticket comment-count assertion.
  const notes = tickets.flatMap((t, i) => Array.from({ length: 2 }, (_, j) => ({
    id: randomUUID(), tenantId: tenant, ticketId: t.id, authorId: ACTOR,
    body: `Note ${i}-${j}`, createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(citizenTickets).values(tickets);
    await tx.insert(citizenTicketNotes).values(notes);
  }));
  return { tickets, notes };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(citizenTicketNotes).where(eq(citizenTicketNotes.tenantId, tenant));
    await tx.delete(citizenTickets).where(eq(citizenTickets.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-019 — citizen-service N+1 fix", () => {
  it("listTicketDetails: query count is O(1) not O(N), each ticket's notes resolve correctly (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listTicketDetails(tenantSmall, 100)));
      const { result: details, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listTicketDetails(tenantLarge, 100)));

      // O(1): identical round-trip count whether the tenant has 3 tickets or
      // 20. The old per-row listNotes loop would have made ~17 more queries
      // for the 20-row tenant than the 3-row one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(details).toHaveLength(LARGE_N);
      const notesByTicket = new Map<string, number>();
      for (const n of large.notes) notesByTicket.set(n.ticketId, (notesByTicket.get(n.ticketId) ?? 0) + 1);
      for (const detail of details) {
        expect(detail.comments).toHaveLength(notesByTicket.get(detail.id) ?? 0);
        expect(detail.comments).toHaveLength(2);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
