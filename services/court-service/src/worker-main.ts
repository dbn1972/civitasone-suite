/**
 * court-service worker process entrypoint. Delegates to startWorker() in
 * worker.ts, which is import-safe (no side effects on import) so tests can
 * drive the real consumer wiring in-process. Run via `pnpm worker`.
 */
import { startWorker } from "./worker.js";

await startWorker();
