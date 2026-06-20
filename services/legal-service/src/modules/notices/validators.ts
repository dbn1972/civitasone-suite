import { z } from "zod";

export const createNoticeBody = z.object({
  noticeNo:  z.string().min(1).max(64),
  subject:   z.string().min(1).max(256),
  partyRef:  z.string().min(1).max(128),
  direction: z.enum(["sent", "received"]),
});
export type CreateNoticeBody = z.infer<typeof createNoticeBody>;

export const respondNoticeBody = z.object({
  responseBody: z.string().min(1).max(8000),
});
export type RespondNoticeBody = z.infer<typeof respondNoticeBody>;

export const idParam = z.object({ id: z.string().uuid() });
