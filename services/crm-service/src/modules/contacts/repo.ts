/**
 * contacts repo — Drizzle queries against `crm.*` ONLY (L2).
 * READS are used by the query path (always behind the cache).
 * WRITES are used ONLY by the consumer, inside the outbox transaction.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contacts, type ContactRow, type ContactInsert, type ContactView } from "./schema.js";

function toView(r: ContactRow): ContactView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ContactView | null> {
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<ContactView[]> {
  const rows = await db.select().from(contacts)
    .where(eq(contacts.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ContactInsert): Promise<void> {
  await tx.insert(contacts).values(row);
}

export async function findByIdTx(tx: Writer, id: string): Promise<ContactView | null> {
  const rows = await tx.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export { toView };
