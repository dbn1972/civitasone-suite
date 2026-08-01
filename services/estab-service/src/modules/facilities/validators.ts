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
});
export type LibraryIssuesQuery = z.infer<typeof libraryIssuesQuery>;

export const renewIssueBody = z.object({
  dueAt: z.string().datetime(),
});
export type RenewIssueBody = z.infer<typeof renewIssueBody>;
