import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  GuesthouseBookingSummaryListSchema,
  LibraryBookSummaryListSchema, LibraryBookSummarySchema,
  LibraryIssueSummaryListSchema,
} from "@civitasone/schemas/web";
import * as queries from "./queries.js";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createGuesthouseBody, bookRoomBody, checkoutBody, addBookBody, issueBookBody,
  libraryBooksQuery, libraryIssuesQuery, renewIssueBody,
} from "./validators.js";
import * as commands from "./commands.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];

export async function facilitiesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/guesthouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createGuesthouseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGuesthouse(ctx, body));
  });

  app.post("/v1/estab/room-bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = bookRoomBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.bookRoom(ctx, body));
  });

  app.patch("/v1/estab/room-bookings/:id/checkin", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.checkin(ctx, id));
  });

  app.patch("/v1/estab/room-bookings/:id/checkout", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = checkoutBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.checkout(ctx, id, body));
  });

  app.post("/v1/estab/library/books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = addBookBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addBook(ctx, body));
  });

  app.post("/v1/estab/library/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = issueBookBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueBook(ctx, body));
  });

  app.get("/v1/estab/guesthouse-bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GuesthouseBookingSummaryListSchema, await queries.listGuesthouseBookingSummaries(ctx.tenantId, q.limit));
  });

  // Alias: some callers use /room-bookings — respond identically
  app.get("/v1/estab/room-bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GuesthouseBookingSummaryListSchema, await queries.listGuesthouseBookingSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/estab/library/books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = libraryBooksQuery.parse(req.query);
    sendValidated(reply, LibraryBookSummaryListSchema, await queries.listLibraryBookSummaries(ctx.tenantId, q.limit, q.search, q.status));
  });

  app.get("/v1/estab/library/books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const book = await queries.getLibraryBookDetail(ctx.tenantId, id);
    if (!book) throw new HttpError(404, "NOT_FOUND", "book not found");
    sendValidated(reply, LibraryBookSummarySchema, book);
  });

  app.get("/v1/estab/library/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = libraryIssuesQuery.parse(req.query);
    sendValidated(reply, LibraryIssueSummaryListSchema, await queries.listLibraryIssueSummaries(ctx.tenantId, q.limit, q.status));
  });

  app.patch("/v1/estab/library/issues/:id/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.returnBook(ctx, id));
  });

  app.patch("/v1/estab/library/issues/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = renewIssueBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.renewBook(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
