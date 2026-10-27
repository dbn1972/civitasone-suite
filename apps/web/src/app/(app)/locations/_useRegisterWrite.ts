"use client";

/**
 * Shared write plumbing for the /locations registers (geofences, infrastructure, jurisdictions).
 *
 * Every write here is CQRS: the route validates, queues a command and answers 202 with the new id; a
 * consumer applies it later. `request()` sends the call and THROWS a display-safe message on failure (never
 * the raw server text or an HTTP status), recording per-field messages for inline display. Success is only
 * ever shown through the shared accepted-write convention (`useAcceptedWrite` + `AcceptedNotice`): when the
 * caller passes `confirm`, the hook polls the resource's real read endpoint (bounded) and says "Done" only
 * once the change is visible; without it, the notice stays at "received, refresh to see it".
 */
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";

export type RegisterWriteResult = { id?: string };

export type RegisterWriteConfirm = {
  /** Gateway path (after /api/proxy) of the single-record read endpoint for the written record. */
  read: (id: string) => string;
  /** True once the polled body shows the change; defaults to "the record exists". */
  isDone?: (body: unknown) => boolean;
};

function idFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as { id?: unknown; data?: { id?: unknown } };
  if (typeof b.id === "string") return b.id;
  if (typeof b.data?.id === "string") return b.data.id;
  return undefined;
}

export function useRegisterWrite(area: string, confirm?: RegisterWriteConfirm) {
  const formError = useFormError(area);
  const accepted = useAcceptedWrite<RegisterWriteResult, unknown>(
    confirm
      ? {
          poll: async (r) => {
            if (!r.id) throw new Error("no id to poll");
            const res = await fetch(`/api/proxy${confirm.read(r.id)}`);
            if (!res.ok) throw new Error("not visible yet");
            return res.json();
          },
          isDone: (body) => (confirm.isDone ? confirm.isDone(body) : true),
        }
      : {},
  );

  async function request(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<RegisterWriteResult> {
    formError.clear();
    let res: Response;
    try {
      res = await fetch(`/api/proxy${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new Error(formError.fromException("save", err).message);
    }
    if (!res.ok) throw new Error((await formError.fromResponse(res, "save")).message);
    const id = idFrom(await res.json().catch(() => null));
    return id ? { id } : {};
  }

  return { request, accepted, formError };
}
