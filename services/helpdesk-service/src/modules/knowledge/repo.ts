import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tickets } from "../tickets/schema.js";
import { ticketKnowledgeLinks, type TicketKnowledgeLinkRow, type TicketKnowledgeLinkInsert } from "./schema.js";

/**
 * Check if a ticket exists for a given tenant. Returns true if it does.
 */
export async function ticketExists(tenantId: string, ticketId: string): Promise<boolean> {
  const rows = await db.transaction((tx) =>
    tx.select({ id: tickets.id }).from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .limit(1),
  );
  return rows.length > 0;
}

/**
 * Find an existing knowledge link for (tenant, ticket, article).
 */
export async function findLink(
  tenantId: string,
  ticketId: string,
  articleId: string,
): Promise<TicketKnowledgeLinkRow | null> {
  const rows = await db.transaction((tx) =>
    tx.select().from(ticketKnowledgeLinks)
      .where(and(
        eq(ticketKnowledgeLinks.tenantId, tenantId),
        eq(ticketKnowledgeLinks.ticketId, ticketId),
        eq(ticketKnowledgeLinks.articleId, articleId),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Insert a knowledge link. Idempotent: if the unique constraint fires, returns
 * the existing row.
 */
export async function insertLink(row: TicketKnowledgeLinkInsert): Promise<{ data: TicketKnowledgeLinkRow; created: boolean }> {
  const existing = await findLink(row.tenantId, row.ticketId, row.articleId);
  if (existing) return { data: existing, created: false };

  try {
    const res = await db.transaction((tx) =>
      tx.insert(ticketKnowledgeLinks).values(row).returning(),
    );
    return { data: res[0]!, created: true };
  } catch (err: unknown) {
    // Unique violation race — another concurrent insert won
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      const now = await findLink(row.tenantId, row.ticketId, row.articleId);
      if (now) return { data: now, created: false };
    }
    throw err;
  }
}

/**
 * List all knowledge links for a ticket.
 */
export async function listLinks(tenantId: string, ticketId: string): Promise<TicketKnowledgeLinkRow[]> {
  return db.transaction((tx) =>
    tx.select().from(ticketKnowledgeLinks)
      .where(and(
        eq(ticketKnowledgeLinks.tenantId, tenantId),
        eq(ticketKnowledgeLinks.ticketId, ticketId),
      )),
  );
}

/**
 * Delete a knowledge link. Returns true if it existed and was deleted.
 */
export async function deleteLink(tenantId: string, ticketId: string, articleId: string): Promise<boolean> {
  const res = await db.transaction((tx) =>
    tx.delete(ticketKnowledgeLinks)
      .where(and(
        eq(ticketKnowledgeLinks.tenantId, tenantId),
        eq(ticketKnowledgeLinks.ticketId, ticketId),
        eq(ticketKnowledgeLinks.articleId, articleId),
      ))
      .returning({ id: ticketKnowledgeLinks.id }),
  );
  return res.length > 0;
}
