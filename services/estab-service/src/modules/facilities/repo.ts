import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabGuesthouses, estabRoomBookings, estabLibraryBooks, estabIssues } from "./schema.js";
import type {
  GuesthouseInsert, RoomBookingRow, RoomBookingInsert,
  LibraryBookInsert, LibraryBookRow, IssueInsert, IssueRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findBookingsByRoom(roomId: string, limit = 200): Promise<RoomBookingRow[]> {
  return db.transaction((tx) => tx.select().from(estabRoomBookings).where(eq(estabRoomBookings.roomId, roomId)).limit(limit));
}

export async function insertGuesthouse(tx: Writer, row: GuesthouseInsert): Promise<void> {
  await tx.insert(estabGuesthouses).values(row);
}

export async function insertRoomBooking(tx: Writer, row: RoomBookingInsert): Promise<void> {
  await tx.insert(estabRoomBookings).values(row);
}

export async function updateRoomBooking(tx: Writer, id: string, patch: Partial<RoomBookingInsert>): Promise<void> {
  await tx.update(estabRoomBookings).set({ ...patch, updatedAt: new Date() }).where(eq(estabRoomBookings.id, id));
}

export async function insertLibraryBook(tx: Writer, row: LibraryBookInsert): Promise<void> {
  await tx.insert(estabLibraryBooks).values(row);
}

export async function decrementCopies(tx: Writer, bookId: string): Promise<void> {
  const rows = await (tx as typeof db).select().from(estabLibraryBooks).where(eq(estabLibraryBooks.id, bookId)).limit(1);
  const book = rows[0];
  if (!book || book.copiesAvailable <= 0) throw new Error("no copies available");
  await tx.update(estabLibraryBooks)
    .set({ copiesAvailable: book.copiesAvailable - 1, updatedAt: new Date() })
    .where(eq(estabLibraryBooks.id, bookId));
}

export async function insertIssue(tx: Writer, row: IssueInsert): Promise<void> {
  await tx.insert(estabIssues).values(row);
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listRoomBookingsByTenant(tenantId: string, limit: number): Promise<RoomBookingRow[]> {
  return db.transaction((tx) => tx.select().from(estabRoomBookings).where(eq(estabRoomBookings.tenantId, tenantId)).limit(limit));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listLibraryBooksByTenant(tenantId: string, limit: number): Promise<LibraryBookRow[]> {
  return db.transaction((tx) => tx.select().from(estabLibraryBooks).where(eq(estabLibraryBooks.tenantId, tenantId)).limit(limit));
}

export async function getLibraryBookById(tenantId: string, id: string): Promise<LibraryBookRow | undefined> {
  const rows = await db.transaction((tx) =>
    tx.select().from(estabLibraryBooks).where(and(eq(estabLibraryBooks.tenantId, tenantId), eq(estabLibraryBooks.id, id))).limit(1),
  );
  return rows[0];
}

export async function getLibraryBookByIdTx(tx: Writer, id: string): Promise<LibraryBookRow | undefined> {
  const rows = await (tx as typeof db).select().from(estabLibraryBooks).where(eq(estabLibraryBooks.id, id)).limit(1);
  return rows[0];
}

export async function incrementCopies(tx: Writer, bookId: string): Promise<void> {
  const rows = await (tx as typeof db).select().from(estabLibraryBooks).where(eq(estabLibraryBooks.id, bookId)).limit(1);
  const book = rows[0];
  if (!book) return;
  const next = Math.min(book.copiesAvailable + 1, book.copiesTotal);
  await tx.update(estabLibraryBooks)
    .set({ copiesAvailable: next, updatedAt: new Date() })
    .where(eq(estabLibraryBooks.id, bookId));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listIssuesByTenant(tenantId: string, limit: number): Promise<IssueRow[]> {
  return db.transaction((tx) => tx.select().from(estabIssues).where(eq(estabIssues.tenantId, tenantId)).limit(limit));
}

export async function getIssueById(tenantId: string, id: string): Promise<IssueRow | undefined> {
  const rows = await db.transaction((tx) =>
    tx.select().from(estabIssues).where(and(eq(estabIssues.tenantId, tenantId), eq(estabIssues.id, id))).limit(1),
  );
  return rows[0];
}

export async function getIssueByIdTx(tx: Writer, id: string): Promise<IssueRow | undefined> {
  const rows = await (tx as typeof db).select().from(estabIssues).where(eq(estabIssues.id, id)).limit(1);
  return rows[0];
}

export async function markIssueReturned(tx: Writer, id: string, returnedAt: Date, actorId: string): Promise<void> {
  await tx.update(estabIssues)
    .set({ status: "returned", returnedAt, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(estabIssues.id, id));
}

export async function updateIssueDueAt(tx: Writer, id: string, dueAt: Date, actorId: string): Promise<void> {
  await tx.update(estabIssues)
    .set({ dueAt, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(estabIssues.id, id));
}
