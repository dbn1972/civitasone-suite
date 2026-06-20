import { createFastifyErrorHandler, isHttpError } from "./http.js";

type HttpErrorCtor = new (status: number, code: string, message: string) => { status: number; code: string; message: string };
type AppLike = { setErrorHandler: (handler: ReturnType<typeof createFastifyErrorHandler>) => void };

/** Register uniform Zod + HTTP error envelope at app level (all domain services). */
export function registerSchemaErrorHandler(app: AppLike, HttpErrorClass?: HttpErrorCtor): void {
  app.setErrorHandler(createFastifyErrorHandler((err) => {
    if (HttpErrorClass && err instanceof HttpErrorClass) {
      return { status: err.status, code: err.code, message: err.message };
    }
    return isHttpError(err) ? err : null;
  }));
}
