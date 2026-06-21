import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabGuesthouses, estabRoomBookings, estabLibraryBooks, estabIssues } from "./schema.js";
import type { GuesthouseInsert, RoomBookingRow, RoomBookingInsert, LibraryBookInsert, IssueInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBookingsByRoom(roomId: string): Promise<RoomBookingRow[]> {
  return db.select().from(estabRoomBookings).where(eq(estabRoomBookings.roomId, roomId));
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

export async function listRoomBookingsByTenant(tenantId: string, limit: number): Promise<RoomBookingRow[]> {
  return db.select().from(estabRoomBookings).where(eq(estabRoomBookings.tenantId, tenantId)).limit(limit);
}
