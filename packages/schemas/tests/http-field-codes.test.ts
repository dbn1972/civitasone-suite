/**
 * UAT T-EDGE bundle 21: the shared error envelope carries the field code a validator tags its
 * issue with (fieldErrors[].code), and passes an HttpError fieldErrors / details through
 * (e.g. 409 TASK_ALREADY_DECIDED with decidedBy).
 */
import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import { createFastifyErrorHandler, zodFieldErrors } from "../src/http.js";
import { registerSchemaErrorHandler } from "../src/plugin.js";
import { zIsoDate, zTrimmedText, FIELD_CODES } from "../src/validators.js";

function harness() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { req: { id: "r1", headers: {}, log: { error: vi.fn() } }, reply: { code }, code, send };
}

describe("field codes in the envelope", () => {
  it("copies params.code into fieldErrors[].code and leaves plain issues unchanged", () => {
    const r = z.object({ d: zIsoDate(), n: zTrimmedText(10), e: z.string().email() }).safeParse({ d: "2025-02-29", n: "   ", e: "a@" });
    expect(r.success).toBe(false);
    const fe = zodFieldErrors((r as { error: ZodError }).error.issues);
    expect(fe.find((f) => f.field === "d")?.code).toBe(FIELD_CODES.DATE_INVALID);
    expect(fe.find((f) => f.field === "n")?.code).toBe(FIELD_CODES.TEXT_BLANK);
    expect(fe.find((f) => f.field === "e")).toEqual({ field: "e", message: expect.any(String) });
    const h = harness();
    createFastifyErrorHandler()((r as { error: ZodError }).error, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(400);
    expect(h.send.mock.calls[0][0].fieldErrors).toEqual(fe);
  });

  it("passes an HttpError fieldErrors and details through the shared handler", () => {
    class HttpError extends Error {
      constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
    }
    let handler: ((err: unknown, req: unknown, reply: unknown) => void) | undefined;
    registerSchemaErrorHandler({ setErrorHandler: (h) => { handler = h as never; } }, HttpError);
    const h = harness();
    handler!(new HttpError(409, "TASK_ALREADY_DECIDED", "already decided", { decidedBy: { id: "u2", name: "Asha Rao" }, code: "SPOOF" }), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(409);
    const body = h.send.mock.calls[0][0];
    expect(body.code).toBe("TASK_ALREADY_DECIDED");
    expect(body.decidedBy).toEqual({ id: "u2", name: "Asha Rao" });
    const h2 = harness();
    const withFields = Object.assign(new HttpError(422, "INDENT_NOT_FOUND", "x"), { fieldErrors: [{ field: "indentRef", message: "m", code: "INDENT_NOT_FOUND" }] });
    handler!(withFields, h2.req, h2.reply);
    expect(h2.send.mock.calls[0][0].fieldErrors).toEqual([{ field: "indentRef", message: "m", code: "INDENT_NOT_FOUND" }]);
  });
});
