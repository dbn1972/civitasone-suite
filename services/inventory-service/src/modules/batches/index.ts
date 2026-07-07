/**
 * Batches module — batch and serial number tracking for inventory items.
 *
 * Exports domain logic, schema definitions, and route registration.
 */
export { validateBatchNotExpired, validateSerialUnique } from "./domain.js";
export { batches, serialNumbers, type BatchRow, type BatchInsert, type SerialNumberRow, type SerialNumberInsert } from "./schema.js";
export { batchRoutes } from "./routes.js";
