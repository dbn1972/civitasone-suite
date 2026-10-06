import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createGuesthouseBody = z.object({
  name:     z.string().min(1),
  location: z.string().optional(),
  contact:  z.string().optional(),
});
export type CreateGuesthouseBody = z.infer<typeof createGuesthouseBody>;

export const bookRoomBody = z.object({
  roomId:      z.string().uuid(),
  guestName:   z.string().min(1),
  guestRef:    z.string().uuid().optional(),
  checkIn:     z.string().datetime(),
  checkOut:    z.string().datetime(),
  sponsorDept: z.string().optional(),
});
export type BookRoomBody = z.infer<typeof bookRoomBody>;

export const checkinBody  = z.object({});
export const checkoutBody = z.object({ chargesMinor: z.number().int().nonnegative().default(0) });
export type CheckoutBody = z.infer<typeof checkoutBody>;

export const addBookBody = z.object({
  accessionNo: z.string().min(1),
  title:       z.string().min(1),
  author:      z.string().optional(),
  isbn:        z.string().optional(),
  category:    z.string().optional(),
  copiesTotal: z.number().int().positive().default(1),
});
export type AddBookBody = z.infer<typeof addBookBody>;

// GAP-ESTAB-LIBRARY-DETAIL-01: edit catalogue metadata + adjust total copies.
// copiesTotal is optional; the command enforces it can't drop below copies out.
export const editBookBody = z.object({
  title:       z.string().min(1).optional(),
  author:      z.string().optional(),
  isbn:        z.string().optional(),
  category:    z.string().optional(),
  copiesTotal: z.number().int().positive().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field is required" });
export type EditBookBody = z.infer<typeof editBookBody>;

export const withdrawBookBody = z.object({
  reason: z.string().min(3),
});
export type WithdrawBookBody = z.infer<typeof withdrawBookBody>;

export const issueBookBody = z.object({
  bookId:      z.string().uuid(),
  employeeRef: z.string().uuid(),
  dueAt:       z.string().datetime(),
});
export type IssueBookBody = z.infer<typeof issueBookBody>;

export const libraryBooksQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().min(1).optional(),
  status: z.enum(["available", "unavailable"]).optional(),
});
export type LibraryBooksQuery = z.infer<typeof libraryBooksQuery>;

export const libraryIssuesQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["issued", "returned", "overdue"]).optional(),
  bookId: z.string().uuid().optional(),
});
export type LibraryIssuesQuery = z.infer<typeof libraryIssuesQuery>;

export const renewIssueBody = z.object({
  dueAt: z.string().datetime(),
});
export type RenewIssueBody = z.infer<typeof renewIssueBody>;
