import { z } from "zod";

export const searchQueryParams = z.object({
  q: z.string().min(1).max(500),
  category: z.string().max(64).optional(),
  tags: z.string().max(500).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchQueryParams = z.infer<typeof searchQueryParams>;

export const indexDocumentBody = z.object({
  documentId: z.string().uuid(),
  title: z.string().min(1).max(500),
  content: z.string().max(100_000).default(""),
  tags: z.array(z.string().max(64)).max(50).default([]),
});
export type IndexDocumentBody = z.infer<typeof indexDocumentBody>;
