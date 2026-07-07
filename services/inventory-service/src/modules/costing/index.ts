/**
 * Costing module — FIFO and WAVG cost-layer engines for inventory valuation.
 *
 * Exports pure domain functions for cost layer consumption and schema
 * definitions for the `cost_layers` table.
 */
export { consumeFifo, type CostLayer, type ConsumedLayer, type ConsumeResult } from "./fifo-engine.js";
export { recomputeWavg, type WavgState, type WavgReceipt } from "./wavg-engine.js";
export { costLayers, type CostLayerRow, type CostLayerInsert } from "./schema.js";
