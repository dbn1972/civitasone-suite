import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

function mapBookingStatus(status: string): "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled" {
  if (status === "confirmed" || status === "booked") return "confirmed";
  if (status === "checked_in") return "checked_in";
  if (status === "checked_out") return "checked_out";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

export async function listGuesthouseBookingSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "guesthouse_bookings", `list:${limit}`),
    () => repo.listRoomBookingsByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    bookingNo: row.id.slice(0, 8).toUpperCase(),
    guestName: row.guestName,
    department: row.sponsorDept ?? undefined,
    checkInDate: new Date(row.checkIn as unknown as string).toISOString().slice(0, 10),
    checkOutDate: new Date(row.checkOut as unknown as string).toISOString().slice(0, 10),
    status: mapBookingStatus(row.status),
  }));
}

function mapBookAvailability(copiesAvailable: number): "available" | "unavailable" {
  return copiesAvailable > 0 ? "available" : "unavailable";
}

function mapBookSummary(row: Awaited<ReturnType<typeof repo.listLibraryBooksByTenant>>[number]) {
  return {
    id: row.id,
    accessionNo: row.accessionNo,
    title: row.title,
    author: row.author ?? undefined,
    isbn: row.isbn ?? undefined,
    category: row.category ?? undefined,
    copiesTotal: row.copiesTotal,
    copiesAvailable: row.copiesAvailable,
    status: mapBookAvailability(row.copiesAvailable),
  };
}

export async function listLibraryBookSummaries(
  tenantId: string, limit: number, search?: string, status?: "available" | "unavailable",
) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "library_books", `list:${limit}`),
    () => repo.listLibraryBooksByTenant(tenantId, limit),
  );
  let list = (rows ?? []).map(mapBookSummary);
  if (search) {
    const s = search.toLowerCase();
    list = list.filter((b) =>
      b.title.toLowerCase().includes(s) ||
      (b.author ?? "").toLowerCase().includes(s) ||
      (b.isbn ?? "").toLowerCase().includes(s) ||
      b.accessionNo.toLowerCase().includes(s));
  }
  if (status) list = list.filter((b) => b.status === status);
  return list;
}

export async function getLibraryBookDetail(tenantId: string, id: string) {
  const row = await repo.getLibraryBookById(tenantId, id);
  if (!row) return null;
  return mapBookSummary(row);
}

function mapIssueStatus(row: { status: string; dueAt: unknown }, now: Date): "issued" | "returned" | "overdue" {
  if (row.status === "returned") return "returned";
  if (row.dueAt && new Date(row.dueAt as unknown as string) < now) return "overdue";
  return "issued";
}

export async function listLibraryIssueSummaries(
  tenantId: string, limit: number, status?: "issued" | "returned" | "overdue",
) {
  const [issues, books] = await Promise.all([
    repo.listIssuesByTenant(tenantId, limit),
    repo.listLibraryBooksByTenant(tenantId, 500),
  ]);
  const titleById = new Map(books.map((b) => [b.id, b.title]));
  const now = new Date();
  let list = issues.map((row) => ({
    id: row.id,
    bookId: row.bookId,
    bookTitle: titleById.get(row.bookId) ?? undefined,
    borrowerRef: row.employeeRef,
    issuedAt: new Date(row.issuedAt as unknown as string).toISOString(),
    dueAt: new Date(row.dueAt as unknown as string).toISOString(),
    returnedAt: row.returnedAt ? new Date(row.returnedAt as unknown as string).toISOString() : undefined,
    status: mapIssueStatus(row, now),
  }));
  if (status) list = list.filter((i) => i.status === status);
  return list;
}
