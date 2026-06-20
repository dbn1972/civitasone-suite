import type { ZodType } from "zod";

type ReplyLike = { code: (status: number) => { send: (body: unknown) => void } };

/** Parse and return validated request body/params/query. */
export function parseRequest<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/** Validate outbound payload before send — closes response-schema gap. */
export function sendValidated<T>(reply: ReplyLike, schema: ZodType<T>, data: unknown, status = 200): void {
  void reply.code(status).send(schema.parse(data));
}

/** Standard 202 command acknowledgement. */
export function sendAccepted<T extends { id: string; status: string; correlationId: string }>(
  reply: ReplyLike,
  schema: ZodType<T>,
  data: unknown,
): void {
  sendValidated(reply, schema, data, 202);
}
