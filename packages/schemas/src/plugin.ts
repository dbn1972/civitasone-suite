import { createFastifyErrorHandler, isHttpError } from "./http.js";

type HttpErrorCtor = new (status: number, code: string, message: string) => { status: number; code: string; message: string };
type AppLike = { setErrorHandler: (handler: ReturnType<typeof createFastifyErrorHandler>) => void };

export type SchemaErrorHandlerOptions = {
  /**
   * Many route modules install their own `app.setErrorHandler` that maps only ZodError + HttpError and
   * answers every other error with a 500. That swallows Fastify framework errors that are really client
   * mistakes (FST_ERR_CTP_EMPTY_JSON_BODY, FST_ERR_CTP_INVALID_JSON, body too large, ...). When set, a
   * module-local handler installed after this call is wrapped so those 4xx framework errors are delegated
   * to the shared handler; every other error still reaches the module handler unchanged.
   * Must be called BEFORE the route plugins are registered.
   */
  delegateFrameworkClientErrors?: boolean;
};

const WRAPPED = Symbol.for("civitasone.schemas.setErrorHandler.wrapped");

function isFrameworkClientError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; statusCode?: unknown };
  if (typeof e.statusCode !== "number" || e.statusCode < 400 || e.statusCode >= 500) return false;
  // Fastify tags body-parse failures as SyntaxError + statusCode 400 (no code); other framework errors use FST_ERR_*.
  return err instanceof SyntaxError || (typeof e.code === "string" && e.code.startsWith("FST_ERR_"));
}

/** Register uniform Zod + HTTP error envelope at app level (all domain services). */
export function registerSchemaErrorHandler(app: AppLike, HttpErrorClass?: HttpErrorCtor, opts: SchemaErrorHandlerOptions = {}): void {
  const shared = createFastifyErrorHandler((err) => {
    if (HttpErrorClass && err instanceof HttpErrorClass) {
      return { status: err.status, code: err.code, message: err.message };
    }
    return isHttpError(err) ? err : null;
  });
  app.setErrorHandler(shared);

  if (!opts.delegateFrameworkClientErrors) return;
  const hooked = app as unknown as { addHook: (name: "onRegister", fn: (instance: Record<string, unknown>) => void) => void };
  hooked.addHook("onRegister", (instance) => {
    const current = instance.setErrorHandler as ((h: unknown) => unknown) & { [WRAPPED]?: (h: unknown) => unknown };
    const real = current[WRAPPED] ?? current;
    const wrapper = function (this: unknown, handler: (...a: unknown[]) => unknown) {
      return real.call(instance, function (this: unknown, err: unknown, req: unknown, reply: unknown) {
        if (isFrameworkClientError(err)) return (shared as unknown as (...a: unknown[]) => unknown)(err, req, reply);
        return handler.call(this, err, req, reply);
      });
    } as unknown as ((h: unknown) => unknown) & { [WRAPPED]?: (h: unknown) => unknown };
    wrapper[WRAPPED] = real;
    instance.setErrorHandler = wrapper;
  });
}
