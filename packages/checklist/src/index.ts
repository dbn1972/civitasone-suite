/**
 * `@civitasone/checklist` — pure checklist domain logic.
 *
 * No database, no Fastify, no I/O. Every export is a deterministic function over
 * plain data so any service can own its own storage and still share one engine.
 * See README.md for why this package exists.
 */
export * from "./types.js";
export * from "./errors.js";
export * from "./answers.js";
export * from "./visibility.js";
export * from "./prerequisites.js";
export * from "./scoring.js";
export * from "./completion.js";
export * from "./validate.js";
export * from "./structure.js";
